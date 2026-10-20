import React, { useRef, useState } from 'react';
import { BrowserMultiFormatReader } from '@zxing/browser';
import { BarcodeFormat, DecodeHintType } from '@zxing/library';

// URL através do proxy configurado no vite.config.ts para contornar problemas de CORS
const IP_CAMERA_URL = '/ipcam/video';

export const LeitorCameraIP: React.FC = () => {
  const imgRef = useRef<HTMLImageElement>(null);
  const animFrameRef = useRef<number | null>(null);
  const lendoRef = useRef<boolean>(false);

  const [resultado, setResultado] = useState<string>('');
  const [conectado, setConectado] = useState<boolean>(false);
  const [motorAtivo, setMotorAtivo] = useState<string>('');
  const [erro, setErro] = useState<string>('');

  // ZXing configurado exclusivamente para CODE_128 e EAN_13 com TRY_HARDER
  const codeReaderRef = useRef(
    new BrowserMultiFormatReader(
      new Map<DecodeHintType, any>([
        [DecodeHintType.POSSIBLE_FORMATS, [BarcodeFormat.CODE_128, BarcodeFormat.EAN_13]],
        [DecodeHintType.TRY_HARDER, true],
      ])
    )
  );

  const pararLeitura = () => {
    lendoRef.current = false;
    if (animFrameRef.current !== null) {
      cancelAnimationFrame(animFrameRef.current);
      animFrameRef.current = null;
    }
    setConectado(false);
  };

  const iniciarLeituraIP = async () => {
    setErro('');
    setResultado('');
    lendoRef.current = true;
    setConectado(true);

    // 1. Prioriza o BarcodeDetector nativo (Google Chrome / Chromium)
    if ('BarcodeDetector' in window) {
      setMotorAtivo('BarcodeDetector Nativo (Chrome)');
      const detector = new (window as any).BarcodeDetector({
        formats: ['code_128', 'ean_13'],
      });

      const scanFrame = async () => {
        if (!lendoRef.current || !imgRef.current) return;

        // Garante que a imagem do stream já possui dados de vídeo
        if (imgRef.current.naturalWidth > 0) {
          try {
            const barcodes = await detector.detect(imgRef.current);
            if (barcodes && barcodes.length > 0) {
              setResultado(barcodes[0].rawValue);
              pararLeitura();
              return;
            }
          } catch {
            // Ignora frames sem detecção
          }
        }

        if (lendoRef.current) {
          animFrameRef.current = requestAnimationFrame(scanFrame);
        }
      };

      animFrameRef.current = requestAnimationFrame(scanFrame);
      return;
    }

    // 2. Fallback: ZXing via elemento de imagem
    setMotorAtivo('ZXing (Code 128 / EAN-13)');
    const scanZxing = async () => {
      if (!lendoRef.current || !imgRef.current) return;

      if (imgRef.current.naturalWidth > 0) {
        try {
          const result = await codeReaderRef.current.decodeFromImageElement(imgRef.current);
          if (result) {
            setResultado(result.getText());
            pararLeitura();
            return;
          }
        } catch {
          // Frame sem código detectado
        }
      }

      if (lendoRef.current) {
        setTimeout(scanZxing, 100); // 100ms para poupar ciclos de CPU
      }
    };

    scanZxing();
  };

  return (
    <div style={{ padding: '20px', maxWidth: '500px', margin: '0 auto', fontFamily: 'sans-serif' }}>
      <h2>Leitor via IP Webcam (Celular)</h2>

      {/* Indicador do motor de leitura */}
      {motorAtivo && (
        <div style={{ marginBottom: '10px', fontSize: '13px', color: '#28a745', fontWeight: 'bold' }}>
          Motor: {motorAtivo}
        </div>
      )}

      {/* Mensagem de Erro, se houver */}
      {erro && (
        <div style={{ marginBottom: '10px', padding: '10px', backgroundColor: '#f8d7da', color: '#721c24', borderRadius: '4px', fontSize: '14px' }}>
          {erro}
        </div>
      )}

      {/* Botões de Ação */}
      <div style={{ marginBottom: '15px' }}>
        {!conectado ? (
          <button
            onClick={iniciarLeituraIP}
            style={{
              padding: '10px 20px',
              backgroundColor: '#007bff',
              color: 'white',
              border: 'none',
              borderRadius: '4px',
              cursor: 'pointer',
              width: '100%',
              fontWeight: 'bold',
            }}
          >
            Conectar à Câmera IP
          </button>
        ) : (
          <button
            onClick={pararLeitura}
            style={{
              padding: '10px 20px',
              backgroundColor: '#dc3545',
              color: 'white',
              border: 'none',
              borderRadius: '4px',
              cursor: 'pointer',
              width: '100%',
              fontWeight: 'bold',
            }}
          >
            Desconectar Câmera
          </button>
        )}
      </div>

      {/* Exibição do Stream MJPEG */}
      <div
        style={{
          width: '100%',
          height: '300px',
          backgroundColor: '#000',
          borderRadius: '8px',
          overflow: 'hidden',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          position: 'relative',
        }}
      >
        {conectado ? (
          <img
            ref={imgRef}
            src={IP_CAMERA_URL}
            alt="Stream IP Webcam"
            crossOrigin="anonymous"
            onError={() => {
              setErro('Não foi possível conectar ao IP da câmera. Verifique se o app IP Webcam está com o servidor ativo e no mesmo Wi-Fi.');
              pararLeitura();
            }}
            style={{ width: '100%', height: '100%', objectFit: 'contain' }}
          />
        ) : (
          <span style={{ color: '#fff' }}>Câmera Desconectada</span>
        )}
      </div>

      {/* Campo do Código */}
      <div style={{ marginTop: '20px' }}>
        <label style={{ display: 'block', marginBottom: '5px', fontWeight: 'bold' }}>
          Código Lido (Code 128 / EAN-13):
        </label>
        <input
          type="text"
          value={resultado}
          readOnly
          placeholder="Aponte a câmera para o código..."
          style={{
            width: '100%',
            padding: '10px',
            fontSize: '16px',
            borderRadius: '4px',
            border: '1px solid #ccc',
            boxSizing: 'border-box',
          }}
        />
      </div>
    </div>
  );
};

// Export padrão alternativo para compatibilidade
export const LeitorCodigo = LeitorCameraIP;
