import react from '@vitejs/plugin-react'
import { defineConfig, type Plugin } from 'vite'
import http from 'node:http'
import basicSsl from '@vitejs/plugin-basic-ssl'

// Plugin para proxy dinâmico do stream MJPEG (permite trocar o IP sem reiniciar o Vite)
function mjpegProxyPlugin(): Plugin {
  return {
    name: 'mjpeg-proxy',
    configureServer(server) {
      server.middlewares.use('/api/mjpeg', (req, res) => {
        const urlObj = new URL(req.url || '', 'http://localhost');
        const targetHost = urlObj.searchParams.get('host') || '192.168.200.75:8080';
        const cleanHost = targetHost.replace(/^https?:\/\//, '').replace(/\/.*$/, '');
        const targetUrl = `http://${cleanHost}/video`;

        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');

        if (req.method === 'OPTIONS') {
          res.writeHead(204);
          res.end();
          return;
        }

        const proxyReq = http.get(targetUrl, { timeout: 6000 }, (targetRes) => {
          res.writeHead(targetRes.statusCode || 200, {
            'Content-Type': targetRes.headers['content-type'] || 'multipart/x-mixed-replace; boundary=--boundarydonotcross',
            'Cache-Control': 'no-cache, no-store, must-revalidate',
            'Connection': 'close',
            'Access-Control-Allow-Origin': '*',
          });
          targetRes.pipe(res);
        });

        proxyReq.on('error', (err) => {
          if (!res.headersSent) {
            res.writeHead(502, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
            res.end(JSON.stringify({ error: `Não foi possível conectar ao IP ${cleanHost}: ${err.message}` }));
          }
        });

        req.on('close', () => {
          proxyReq.destroy();
        });
      });
    },
  };
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), basicSsl(), mjpegProxyPlugin()],
  server: {
    host: true, // Permite acesso via IP local pelo celular na mesma rede Wi-Fi
    proxy: {
      '/ipcam': {
        target: 'http://192.168.200.75:8080',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/ipcam/, ''),
      },
    },
  },
})
