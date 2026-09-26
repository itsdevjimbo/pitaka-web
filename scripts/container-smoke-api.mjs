import { createServer } from 'node:http';

createServer((request, response) => {
  if (request.url === '/api/image-smoke-failure') {
    response.writeHead(503, { 'content-type': 'text/plain' });
    response.end('controlled upstream failure');
    return;
  }

  response.writeHead(200, { 'content-type': 'text/plain' });
  response.end(`${request.method} ${request.url}`);
}).listen(8080, '0.0.0.0');
