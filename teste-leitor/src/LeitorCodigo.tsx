import React, { useCallback, useEffect, useRef, useState } from 'react';
import { BrowserMultiFormatReader } from '@zxing/browser';
import { BarcodeFormat, DecodeHintType } from '@zxing/library';

// URL padrão para Câmera IP através do proxy no vite.config.ts
const IP_CAMERA_URL = '/ipcam/video';

export const LeitorCodigo: React.FC = () => {
  // Elementos DOM
  const videoRef = useRef<HTMLVideoElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const roiRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Controle de Stream e Loop
  const streamRef = useRef<MediaStream | null>(null);
  const animFrameRef = useRef<number | null>(null);
  const scanningRef = useRef<boolean>(false);
  const lastScanTimeRef = useRef<number>(0);
  const ultimoCodigoLidoRef = useRef<string>('');
  const ultimoTimestampLidoRef = useRef<number>(0);
  const loopLeituraRef = useRef<() => void>(() => {});

  // Leitores de Código
  const codeReaderRef = useRef<BrowserMultiFormatReader | null>(null);
  const barcodeDetectorRef = useRef<any>(null);

  // Estados da Aplicação
  const [fonte, setFonte] = useState<'camera' | 'ipcam'>('camera');
  const [conectado, setConectado] = useState<boolean>(false);
  const [resultado, setResultado] = useState<string>('');
  const [formatoLido, setFormatoLido] = useState<string>('');
  const [motorAtivo] = useState<string>(() => {
    if (typeof window !== 'undefined' && 'BarcodeDetector' in window) {
      return 'BarcodeDetector Nativo + ZXing (Recorte ROI)';
    }
    return 'ZXing (Recorte ROI)';
  });
  const [erro, setErro] = useState<string>('');
  const [sucessoScan, setSucessoScan] = useState<boolean>(false);
  const [copiado, setCopiado] = useState<boolean>(false);

  // Opções de Leitura
  const [apenas1D, setApenas1D] = useState<boolean>(true);
  const [leituraContinua, setLeituraContinua] = useState<boolean>(false);
  const [mostrarPreviewCanvas, setMostrarPreviewCanvas] = useState<boolean>(false);
  const [resolucaoRoi, setResolucaoRoi] = useState<string>('');

  // Dispositivos e Lanterna
  const [cameras, setCameras] = useState<MediaDeviceInfo[]>([]);
  const [selectedDeviceId, setSelectedDeviceId] = useState<string>('');
  const [torchDisponivel, setTorchDisponivel] = useState<boolean>(false);
  const [torchAtiva, setTorchAtiva] = useState<boolean>(false);

  // Histórico de Leituras
  const [historico, setHistorico] = useState<Array<{ codigo: string; formato: string; hora: string }>>([]);

  // Parar a leitura e liberar hardware
  const pararLeitura = useCallback(() => {
    scanningRef.current = false;
    if (animFrameRef.current !== null) {
      cancelAnimationFrame(animFrameRef.current);
      animFrameRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    setTorchAtiva(false);
    setConectado(false);
  }, []);

  // Inicializa o leitor ZXing com hints focados em performance
  const inicializarZXing = useCallback((only1D: boolean) => {
    const hints = new Map<DecodeHintType, any>();
    if (only1D) {
      hints.set(DecodeHintType.POSSIBLE_FORMATS, [
        BarcodeFormat.CODE_128,
      ]);
    } else {
      hints.set(DecodeHintType.POSSIBLE_FORMATS, [
        BarcodeFormat.CODE_128,
      ]);
    }
    hints.set(DecodeHintType.TRY_HARDER, true);
    codeReaderRef.current = new BrowserMultiFormatReader(hints);
  }, []);

  // Atualiza leitor de código ao alterar modo 1D
  useEffect(() => {
    inicializarZXing(apenas1D);

    if (typeof window !== 'undefined' && 'BarcodeDetector' in window) {
      try {
        const formats = apenas1D
          ? ['code_128']
          : ['code_128'];
        barcodeDetectorRef.current = new (window as any).BarcodeDetector({ formats });
      } catch {
        barcodeDetectorRef.current = null;
      }
    }
  }, [apenas1D, inicializarZXing]);

  // Lista câmeras disponíveis
  const listarCameras = async () => {
    try {
      if (navigator.mediaDevices && navigator.mediaDevices.enumerateDevices) {
        const devices = await navigator.mediaDevices.enumerateDevices();
        const videoInputs = devices.filter((d) => d.kind === 'videoinput');
        setCameras(videoInputs);
        if (videoInputs.length > 0 && !selectedDeviceId) {
          // Prefere câmera traseira (environment) se identificada no label
          const traseira = videoInputs.find(
            (c) =>
              c.label.toLowerCase().includes('back') ||
              c.label.toLowerCase().includes('traseira') ||
              c.label.toLowerCase().includes('environment') ||
              c.label.toLowerCase().includes('rear')
          );
          setSelectedDeviceId(traseira ? traseira.deviceId : videoInputs[0].deviceId);
        }
      }
    } catch (e) {
      console.warn('Erro ao listar câmeras:', e);
    }
  };

  // Beep sonoro nativo via Web Audio API
  const emitirBeep = () => {
    try {
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      if (!AudioCtx) return;
      const ctx = new AudioCtx();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(1850, ctx.currentTime);
      gain.gain.setValueAtTime(0.25, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.12);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.12);
    } catch {
      // Silencia caso áudio seja restrito pelo navegador
    }
  };

  // Recorta APENAS a Região de Interesse (ROI) do <video> para o <canvas> auxiliar
  const extrairPixelsROI = useCallback((): boolean => {
    const canvas = canvasRef.current;
    const roi = roiRef.current;
    if (!canvas || !roi) return false;

    let mediaEl: HTMLVideoElement | HTMLImageElement | null = null;
    let naturalW = 0;
    let naturalH = 0;

    if (fonte === 'camera') {
      const video = videoRef.current;
      if (!video || video.readyState < 2 || video.videoWidth === 0) return false;
      mediaEl = video;
      naturalW = video.videoWidth;
      naturalH = video.videoHeight;
    } else {
      const img = imgRef.current;
      if (!img || img.naturalWidth === 0) return false;
      mediaEl = img;
      naturalW = img.naturalWidth;
      naturalH = img.naturalHeight;
    }

    const mediaRect = mediaEl.getBoundingClientRect();
    const roiRect = roi.getBoundingClientRect();

    if (mediaRect.width === 0 || mediaRect.height === 0) return false;

    // A mídia é renderizada com objectFit: 'cover' dentro do container.
    // Calculamos a escala real entre os pixels nativos e o que está visível na tela.
    const scale = Math.max(mediaRect.width / naturalW, mediaRect.height / naturalH);
    const renderedW = naturalW * scale;
    const renderedH = naturalH * scale;

    // Deslocamento da mídia centralizada
    const screenLeft = mediaRect.left + (mediaRect.width - renderedW) / 2;
    const screenTop = mediaRect.top + (mediaRect.height - renderedH) / 2;

    // Mapeamento das coordenadas da mira (ROI) para os pixels nativos da câmera
    let cropX = (roiRect.left - screenLeft) / scale;
    let cropY = (roiRect.top - screenTop) / scale;
    let cropW = roiRect.width / scale;
    let cropH = roiRect.height / scale;

    // Delimitação segura aos limites reais da mídia
    cropX = Math.max(0, Math.min(cropX, naturalW - 1));
    cropY = Math.max(0, Math.min(cropY, naturalH - 1));
    cropW = Math.max(1, Math.min(cropW, naturalW - cropX));
    cropH = Math.max(1, Math.min(cropH, naturalH - cropY));

    // Ajusta dimensões do canvas para a resolução nativa exata do corte
    const targetW = Math.round(cropW);
    const targetH = Math.round(cropH);

    if (canvas.width !== targetW || canvas.height !== targetH) {
      canvas.width = targetW;
      canvas.height = targetH;
      setResolucaoRoi(`${targetW} x ${targetH} px`);
    }

    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return false;

    // Copia estritamente os pixels da mira para o canvas auxiliar
    ctx.drawImage(
      mediaEl,
      cropX, cropY, cropW, cropH,
      0, 0, targetW, targetH
    );

    return true;
  }, [fonte]);

  // Processa código reconhecido
  const processarCodigoDetectado = useCallback(
    (codigo: string, formato: string) => {
      const agora = Date.now();
      // Evita repetição instantânea do mesmo código em menos de 1.5s
      if (codigo === ultimoCodigoLidoRef.current && agora - ultimoTimestampLidoRef.current < 1500) {
        return;
      }
      // Verificação do tamanho do código de barras, obrigatóriamente 44 digitos
      if (codigo.length != 44){
        console.log("O código CODE_128 lido não tem 44 caracteres.")
        return;
      }
      ultimoCodigoLidoRef.current = codigo;
      ultimoTimestampLidoRef.current = agora;

      setResultado(codigo);
      setFormatoLido(formato);
      setSucessoScan(true);
      
      // Feedback sonoro e tátil
      emitirBeep();
      if (navigator.vibrate) {
        navigator.vibrate(100);
      }

      // Adiciona ao histórico de leituras
      const hora = new Date().toLocaleTimeString();
      setHistorico((prev) => [{ codigo, formato, hora }, ...prev.slice(0, 9)]);

      // Efeito visual no retângulo de mira
      setTimeout(() => {
        setSucessoScan(false);
      }, 500);

      if (!leituraContinua) {
        pararLeitura();
      }
    },
    [leituraContinua, pararLeitura]
  );

  // Loop contínuo de escaneamento sobre o canvas auxiliar
  const loopLeitura = useCallback(async () => {
    if (!scanningRef.current) return;

    const agora = performance.now();
    // Throttle de ~80ms (~12 leituras/segundo) para poupar CPU e manter alta precisão
    if (agora - lastScanTimeRef.current >= 80) {
      lastScanTimeRef.current = agora;

      const recortou = extrairPixelsROI();
      if (recortou && canvasRef.current) {
        const canvas = canvasRef.current;
        let codigoEncontrado: string | null = null;
        let formatoEncontrado: string = '';

        // 1. Tenta via BarcodeDetector nativo (se disponível no navegador)
        if (barcodeDetectorRef.current) {
          try {
            const barcodes = await barcodeDetectorRef.current.detect(canvas);
            if (barcodes && barcodes.length > 0) {
              codigoEncontrado = barcodes[0].rawValue;
              formatoEncontrado = barcodes[0].format || 'BarcodeDetector';
            }
          } catch {
            // Frame sem código
          }
        }

        // 2. Se não detectou, decodifica com ZXing a partir do CANVAS recortado
        if (!codigoEncontrado && codeReaderRef.current) {
          try {
            const zxingResult = codeReaderRef.current.decodeFromCanvas(canvas);
            if (zxingResult) {
              codigoEncontrado = zxingResult.getText();
              formatoEncontrado = zxingResult.getBarcodeFormat()?.toString() || 'ZXing';
            }
          } catch {
            // Normal: frame não possui código legível
          }
        }

        if (codigoEncontrado) {
          processarCodigoDetectado(codigoEncontrado, formatoEncontrado);
        }
      }
    }

    if (scanningRef.current) {
      animFrameRef.current = requestAnimationFrame(() => loopLeituraRef.current());
    }
  }, [extrairPixelsROI, processarCodigoDetectado]);

  // Atualiza referência mutável do loop
  useEffect(() => {
    loopLeituraRef.current = loopLeitura;
  }, [loopLeitura]);

  // Iniciar Leitura via Câmera do Celular / WebCam (<video>)
  const iniciarCamera = async () => {
    setErro('');
    pararLeitura();

    try {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        if (!window.isSecureContext) {
          setErro(
            'Acesso à câmera bloqueado: navegadores móveis exigem conexão segura (HTTPS) para liberar a câmera. Acesse com https:// (ex: https://' +
              window.location.host +
              ') e aceite o certificado.'
          );
        } else {
          setErro('A API de câmera (navigator.mediaDevices.getUserMedia) não está disponível neste navegador.');
        }
        setConectado(false);
        return;
      }

      const constraints: MediaStreamConstraints = {
        video: {
          deviceId: selectedDeviceId ? { exact: selectedDeviceId } : undefined,
          facingMode: selectedDeviceId ? undefined : { ideal: 'environment' },
          width: { ideal: 1920 },
          height: { ideal: 1080 },
        },
        audio: false,
      };

      let stream: MediaStream;
      try {
        stream = await navigator.mediaDevices.getUserMedia(constraints);
      } catch (firstErr) {
        console.warn('Falha nas restrições completas da câmera, usando fallback flexível:', firstErr);
        // Fallback sem resolução fixa para garantir compatibilidade em qualquer celular/orientação
        stream = await navigator.mediaDevices.getUserMedia({
          video: selectedDeviceId ? { deviceId: { exact: selectedDeviceId } } : { facingMode: { ideal: 'environment' } },
          audio: false,
        });
      }

      streamRef.current = stream;

      // Verifica suporte à lanterna (torch)
      const track = stream.getVideoTracks()[0];
      const capabilities = (track && typeof track.getCapabilities === 'function' ? track.getCapabilities() : null) as any;
      setTorchDisponivel(!!capabilities?.torch);
      setTorchAtiva(false);

      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play().catch((playErr) => {
          console.warn('Erro ao reproduzir stream de vídeo:', playErr);
        });
      }

      await listarCameras();

      setConectado(true);
      scanningRef.current = true;
      animFrameRef.current = requestAnimationFrame(() => loopLeituraRef.current());
    } catch (err: any) {
      console.error('Falha ao acessar câmera:', err);
      if (err.name === 'NotAllowedError') {
        setErro('Permissão de acesso à câmera negada. Habilite a permissão nas configurações do navegador.');
      } else {
        setErro(`Não foi possível iniciar a câmera: ${err.message || 'Verifique se há câmera disponível.'}`);
      }
      setConectado(false);
    }
  };

  // Iniciar Leitura via Câmera IP (Stream MJPEG)
  const iniciarIPCam = () => {
    setErro('');
    pararLeitura();
    setConectado(true);
    scanningRef.current = true;
    animFrameRef.current = requestAnimationFrame(() => loopLeituraRef.current());
  };

  // Alterna lanterna se suportada
  const alternarLanterna = async () => {
    if (!streamRef.current) return;
    const track = streamRef.current.getVideoTracks()[0];
    if (!track) return;
    try {
      const novoEstado = !torchAtiva;
      await (track as any).applyConstraints({
        advanced: [{ torch: novoEstado }],
      });
      setTorchAtiva(novoEstado);
    } catch (e) {
      console.warn('Não foi possível acionar a lanterna:', e);
    }
  };

  // Copia o resultado para a área de transferência
  const copiarResultado = async () => {
    if (!resultado) return;
    try {
      await navigator.clipboard.writeText(resultado);
      setCopiado(true);
      setTimeout(() => setCopiado(false), 2000);
    } catch {
      // Fallback
    }
  };

  // Limpeza ao desmontar componente
  useEffect(() => {
    return () => {
      pararLeitura();
    };
  }, [pararLeitura]);

  return (
    <div style={{ maxWidth: '540px', margin: '0 auto', fontFamily: 'system-ui, -apple-system, sans-serif' }}>
      {/* Cabeçalho */}
      <div style={{ textAlign: 'center', marginBottom: '16px' }}>
        <h2 style={{ margin: '0 0 6px', fontSize: '22px', color: '#1e293b' }}>
          Leitor de Código de Barras (ROI)
        </h2>
        <p style={{ margin: 0, fontSize: '13px', color: '#64748b' }}>
          Recorte por Região de Interesse com mira e laser vermelho
        </p>
      </div>

      {/* Seletor de Fonte da Câmera */}
      <div
        style={{
          display: 'flex',
          backgroundColor: '#e2e8f0',
          borderRadius: '8px',
          padding: '4px',
          marginBottom: '14px',
          gap: '4px',
        }}
      >
        <button
          onClick={() => {
            if (fonte !== 'camera') {
              pararLeitura();
              setFonte('camera');
            }
          }}
          style={{
            flex: 1,
            padding: '8px 12px',
            borderRadius: '6px',
            border: 'none',
            fontSize: '13px',
            fontWeight: fonte === 'camera' ? 'bold' : 'normal',
            backgroundColor: fonte === 'camera' ? '#ffffff' : 'transparent',
            color: fonte === 'camera' ? '#0f172a' : '#64748b',
            boxShadow: fonte === 'camera' ? '0 1px 3px rgba(0,0,0,0.1)' : 'none',
            cursor: 'pointer',
            transition: 'all 0.2s',
          }}
        >
          📱 Câmera do Celular (&lt;video&gt;)
        </button>
        <button
          onClick={() => {
            if (fonte !== 'ipcam') {
              pararLeitura();
              setFonte('ipcam');
            }
          }}
          style={{
            flex: 1,
            padding: '8px 12px',
            borderRadius: '6px',
            border: 'none',
            fontSize: '13px',
            fontWeight: fonte === 'ipcam' ? 'bold' : 'normal',
            backgroundColor: fonte === 'ipcam' ? '#ffffff' : 'transparent',
            color: fonte === 'ipcam' ? '#0f172a' : '#64748b',
            boxShadow: fonte === 'ipcam' ? '0 1px 3px rgba(0,0,0,0.1)' : 'none',
            cursor: 'pointer',
            transition: 'all 0.2s',
          }}
        >
          🌐 Câmera IP (MJPEG)
        </button>
      </div>

      {/* Indicador de Status e Motor Ativo */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: '12px',
          padding: '6px 12px',
          backgroundColor: '#f8fafc',
          borderRadius: '6px',
          border: '1px solid #e2e8f0',
          fontSize: '12px',
        }}
      >
        <span style={{ color: '#475569' }}>
          Status: <strong style={{ color: conectado ? '#16a34a' : '#dc2626' }}>{conectado ? 'Ativo' : 'Parado'}</strong>
        </span>
        {motorAtivo && (
          <span style={{ color: '#0284c7', fontWeight: '500' }}>
            ⚙️ {motorAtivo}
          </span>
        )}
      </div>

      {/* Mensagem de Erro */}
      {erro && (
        <div
          style={{
            marginBottom: '14px',
            padding: '10px 14px',
            backgroundColor: '#fef2f2',
            color: '#b91c1c',
            border: '1px solid #fecaca',
            borderRadius: '6px',
            fontSize: '13px',
          }}
        >
          ⚠️ {erro}
        </div>
      )}

      {/* CONTEINER PRINCIPAL COM O <video> E A MIRA (ROI) SOBREPOSTA */}
      <div
        ref={containerRef}
        style={{
          position: 'relative',
          width: '100%',
          height: '340px',
          backgroundColor: '#000000',
          borderRadius: '12px',
          overflow: 'hidden',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          boxShadow: '0 4px 12px rgba(0, 0, 0, 0.15)',
        }}
      >
        {/* Vídeo do Dispositivo */}
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted
          style={{
            width: '100%',
            height: '100%',
            objectFit: 'cover',
            display: conectado && fonte === 'camera' ? 'block' : 'none',
          }}
        />

        {/* Stream de Câmera IP */}
        {fonte === 'ipcam' && conectado && (
          <img
            ref={imgRef}
            src={IP_CAMERA_URL}
            alt="Stream IP Webcam"
            crossOrigin="anonymous"
            onError={() => {
              setErro('Não foi possível conectar ao IP da câmera. Verifique se o app IP Webcam está ativo na mesma rede Wi-Fi.');
              pararLeitura();
            }}
            style={{
              width: '100%',
              height: '100%',
              objectFit: 'cover',
              display: 'block',
            }}
          />
        )}

        {/* Mensagem quando a câmera estiver desconectada */}
        {!conectado && (
          <div style={{ color: '#94a3b8', textAlign: 'center', padding: '20px' }}>
            <div style={{ fontSize: '38px', marginBottom: '8px' }}>📷</div>
            <div style={{ fontSize: '15px', fontWeight: 'bold', color: '#f1f5f9' }}>
              Câmera Desconectada
            </div>
            <div style={{ fontSize: '12px', marginTop: '4px' }}>
              Pressione o botão abaixo para iniciar
            </div>
          </div>
        )}

        {/* MIRA SOBREPOSTA (RETÂNGULO ROI COM LINHA VERMELHA) */}
        {conectado && (
          <>
            {/* Retângulo Central de Mira (ROI) */}
            <div
              ref={roiRef}
              style={{
                position: 'absolute',
                top: '50%',
                left: '50%',
                transform: 'translate(-50%, -50%)',
                width: '84%',
                maxWidth: '340px',
                height: '140px',
                borderRadius: '10px',
                border: sucessoScan ? '2px solid #00e676' : '1.5px solid rgba(255, 255, 255, 0.35)',
                // Sombra gigantesca que escurece tudo fora do retângulo
                boxShadow: sucessoScan
                  ? '0 0 0 9999px rgba(0, 0, 0, 0.6), 0 0 20px #00e676'
                  : '0 0 0 9999px rgba(0, 0, 0, 0.52)',
                pointerEvents: 'none',
                transition: 'border 0.2s, box-shadow 0.2s',
                zIndex: 10,
              }}
            >
              {/* Cantoneiras Estilizadas da Mira */}
              <div
                style={{
                  position: 'absolute',
                  top: '-2px',
                  left: '-2px',
                  width: '18px',
                  height: '18px',
                  borderTop: '3px solid #00e676',
                  borderLeft: '3px solid #00e676',
                  borderTopLeftRadius: '8px',
                }}
              />
              <div
                style={{
                  position: 'absolute',
                  top: '-2px',
                  right: '-2px',
                  width: '18px',
                  height: '18px',
                  borderTop: '3px solid #00e676',
                  borderRight: '3px solid #00e676',
                  borderTopRightRadius: '8px',
                }}
              />
              <div
                style={{
                  position: 'absolute',
                  bottom: '-2px',
                  left: '-2px',
                  width: '18px',
                  height: '18px',
                  borderBottom: '3px solid #00e676',
                  borderLeft: '3px solid #00e676',
                  borderBottomLeftRadius: '8px',
                }}
              />
              <div
                style={{
                  position: 'absolute',
                  bottom: '-2px',
                  right: '-2px',
                  width: '18px',
                  height: '18px',
                  borderBottom: '3px solid #00e676',
                  borderRight: '3px solid #00e676',
                  borderBottomRightRadius: '8px',
                }}
              />

              {/* LINHA VERMELHA (LASER ANIMADO DE VARREDURA) */}
              <div
                style={{
                  position: 'absolute',
                  left: '4px',
                  right: '4px',
                  height: '2px',
                  background: 'linear-gradient(90deg, transparent, #ff1744 20%, #ff1744 80%, transparent)',
                  boxShadow: '0 0 8px 2px rgba(255, 23, 68, 0.9), 0 0 16px 4px rgba(255, 23, 68, 0.5)',
                  animation: 'laserSweep 2s ease-in-out infinite',
                }}
              />
            </div>

            {/* Instrução visual na parte inferior do vídeo */}
            <div
              style={{
                position: 'absolute',
                bottom: '12px',
                left: '50%',
                transform: 'translateX(-50%)',
                backgroundColor: 'rgba(0, 0, 0, 0.75)',
                color: '#f8fafc',
                padding: '4px 14px',
                borderRadius: '20px',
                fontSize: '11px',
                fontWeight: '500',
                pointerEvents: 'none',
                zIndex: 11,
                whiteSpace: 'nowrap',
                letterSpacing: '0.3px',
              }}
            >
              🎯 Alinhe o código de barras na linha vermelha
            </div>
          </>
        )}
      </div>

      {/* CANVAS AUXILIAR OCULTO (UTILIZADO PARA RECORTAR OS PIXELS DA ROI) */}
      <canvas
        ref={canvasRef}
        style={{
          display: mostrarPreviewCanvas ? 'block' : 'none',
          width: '100%',
          maxHeight: '100px',
          objectFit: 'contain',
          marginTop: '10px',
          backgroundColor: '#0f172a',
          borderRadius: '6px',
          border: '1px dashed #38bdf8',
        }}
      />
      {mostrarPreviewCanvas && resolucaoRoi && (
        <div style={{ fontSize: '11px', color: '#64748b', textAlign: 'center', marginTop: '2px' }}>
          Resolução Real do Recorte ROI: <strong>{resolucaoRoi}</strong>
        </div>
      )}

      {/* Botões de Controle da Câmera */}
      <div style={{ marginTop: '16px', display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
        {!conectado ? (
          <button
            onClick={fonte === 'camera' ? iniciarCamera : iniciarIPCam}
            style={{
              flex: 1,
              padding: '12px 20px',
              backgroundColor: '#2563eb',
              color: '#ffffff',
              border: 'none',
              borderRadius: '8px',
              cursor: 'pointer',
              fontWeight: 'bold',
              fontSize: '15px',
              boxShadow: '0 2px 4px rgba(37, 99, 235, 0.3)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '8px',
            }}
          >
            ▶️ Conectar à Câmera
          </button>
        ) : (
          <button
            onClick={pararLeitura}
            style={{
              flex: 1,
              padding: '12px 20px',
              backgroundColor: '#dc2626',
              color: '#ffffff',
              border: 'none',
              borderRadius: '8px',
              cursor: 'pointer',
              fontWeight: 'bold',
              fontSize: '15px',
              boxShadow: '0 2px 4px rgba(220, 38, 38, 0.3)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '8px',
            }}
          >
            ⏹️ Parar Leitura
          </button>
        )}

        {/* Botão de Lanterna (se disponível) */}
        {conectado && torchDisponivel && fonte === 'camera' && (
          <button
            onClick={alternarLanterna}
            style={{
              padding: '12px 16px',
              backgroundColor: torchAtiva ? '#eab308' : '#334155',
              color: '#ffffff',
              border: 'none',
              borderRadius: '8px',
              cursor: 'pointer',
              fontSize: '14px',
              fontWeight: 'bold',
            }}
            title="Ligar/Desligar Lanterna"
          >
            {torchAtiva ? '🔦 Lanterna Ligada' : '🔦 Lanterna'}
          </button>
        )}
      </div>

      {/* Seleção de Câmera (Frente/Verso) */}
      {fonte === 'camera' && cameras.length > 1 && (
        <div style={{ marginTop: '12px' }}>
          <label style={{ display: 'block', fontSize: '12px', fontWeight: 'bold', color: '#475569', marginBottom: '4px' }}>
            Escolher Dispositivo de Câmera:
          </label>
          <select
            value={selectedDeviceId}
            onChange={(e) => {
              setSelectedDeviceId(e.target.value);
              if (conectado) {
                setTimeout(iniciarCamera, 100);
              }
            }}
            style={{
              width: '100%',
              padding: '8px 10px',
              borderRadius: '6px',
              border: '1px solid #cbd5e1',
              backgroundColor: '#ffffff',
              fontSize: '13px',
              color: '#1e293b',
            }}
          >
            {cameras.map((c, i) => (
              <option key={c.deviceId || i} value={c.deviceId}>
                {c.label || `Câmera ${i + 1}`}
              </option>
            ))}
          </select>
        </div>
      )}

      {/* Opções e Configurações de Leitura */}
      <div
        style={{
          marginTop: '14px',
          padding: '12px',
          backgroundColor: '#f8fafc',
          borderRadius: '8px',
          border: '1px solid #e2e8f0',
          display: 'flex',
          flexDirection: 'column',
          gap: '8px',
          fontSize: '13px',
        }}
      >
        <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', color: '#334155' }}>
          <input
            type="checkbox"
            checked={apenas1D}
            onChange={(e) => setApenas1D(e.target.checked)}
          />
          <strong>Modo Turbo 1D:</strong> Focar em Code 128 / EAN-13 (mais rápido no celular)
        </label>

        <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', color: '#334155' }}>
          <input
            type="checkbox"
            checked={leituraContinua}
            onChange={(e) => setLeituraContinua(e.target.checked)}
          />
          <strong>Leitura Contínua:</strong> Não parar após ler o primeiro código
        </label>

        <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', color: '#334155' }}>
          <input
            type="checkbox"
            checked={mostrarPreviewCanvas}
            onChange={(e) => setMostrarPreviewCanvas(e.target.checked)}
          />
          <strong>Depuração:</strong> Exibir corte do &lt;canvas&gt; auxiliar em tempo real
        </label>
      </div>

      {/* Resultado da Leitura */}
      <div
        style={{
          marginTop: '18px',
          padding: '16px',
          backgroundColor: '#ffffff',
          borderRadius: '10px',
          border: '1px solid #cbd5e1',
          boxShadow: '0 2px 6px rgba(0, 0, 0, 0.05)',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
          <label style={{ fontWeight: 'bold', fontSize: '13px', color: '#334155' }}>
            Último Código Lido:
          </label>
          {formatoLido && (
            <span
              style={{
                fontSize: '11px',
                padding: '2px 8px',
                backgroundColor: '#dcfce7',
                color: '#15803d',
                borderRadius: '12px',
                fontWeight: 'bold',
              }}
            >
              {formatoLido}
            </span>
          )}
        </div>

        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          <input
            type="text"
            value={resultado}
            readOnly
            placeholder="Aponte a mira para o código de barras..."
            style={{
              flex: 1,
              padding: '10px 12px',
              fontSize: '16px',
              fontWeight: 'bold',
              color: '#0f172a',
              backgroundColor: '#f1f5f9',
              borderRadius: '6px',
              border: '1px solid #cbd5e1',
              boxSizing: 'border-box',
              letterSpacing: '0.5px',
            }}
          />

          {resultado && (
            <button
              onClick={copiarResultado}
              style={{
                padding: '10px 14px',
                backgroundColor: copiado ? '#16a34a' : '#475569',
                color: '#ffffff',
                border: 'none',
                borderRadius: '6px',
                cursor: 'pointer',
                fontWeight: 'bold',
                fontSize: '13px',
                whiteSpace: 'nowrap',
              }}
            >
              {copiado ? '✓ Copiado' : 'Copiar'}
            </button>
          )}
        </div>
      </div>

      {/* Histórico Recente de Leituras */}
      {historico.length > 0 && (
        <div style={{ marginTop: '16px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
            <span style={{ fontSize: '13px', fontWeight: 'bold', color: '#475569' }}>
              Histórico Recente ({historico.length})
            </span>
            <button
              onClick={() => setHistorico([])}
              style={{
                background: 'none',
                border: 'none',
                color: '#dc2626',
                fontSize: '11px',
                cursor: 'pointer',
                padding: '2px 6px',
              }}
            >
              Limpar histórico
            </button>
          </div>

          <div
            style={{
              backgroundColor: '#ffffff',
              borderRadius: '8px',
              border: '1px solid #e2e8f0',
              overflow: 'hidden',
              fontSize: '13px',
            }}
          >
            {historico.map((item, index) => (
              <div
                key={index}
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  padding: '8px 12px',
                  borderBottom: index < historico.length - 1 ? '1px solid #f1f5f9' : 'none',
                  backgroundColor: index % 2 === 0 ? '#fafafa' : '#ffffff',
                }}
              >
                <span style={{ fontFamily: 'monospace', fontWeight: 'bold', color: '#1e293b' }}>
                  {item.codigo}
                </span>
                <span style={{ color: '#94a3b8', fontSize: '11px' }}>
                  {item.formato} • {item.hora}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

// Export para compatibilidade reversa
export const LeitorCameraIP = LeitorCodigo;
