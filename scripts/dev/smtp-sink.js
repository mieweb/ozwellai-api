#!/usr/bin/env node

/**
 * Local-only SMTP sink: prints messages without delivering them. Never use
 * production credentials or data. Read test codes from this process's output.
 *
 *   node scripts/dev/smtp-sink.js 2525
 *   SMTP_URL=smtp://127.0.0.1:2525 ./scripts/start.sh
 */

import net from 'node:net';

const PORT = Number(process.argv[2] || 2525);

net
  .createServer((socket) => {
    let inData = false;
    let message = [];
    let buffer = '';
    socket.setEncoding('utf8');

    socket.write('220 smtp-sink ready\r\n');

    socket.on('data', (chunk) => {
      buffer += chunk;
      let lineEnd;
      while ((lineEnd = buffer.indexOf('\r\n')) !== -1) {
        const line = buffer.slice(0, lineEnd);
        buffer = buffer.slice(lineEnd + 2);
        if (inData) {
          if (line === '.') {
            inData = false;
            console.log('\n========== MESSAGE RECEIVED ==========');
            console.log(message.join('\n'));
            console.log('======================================\n');
            message = [];
            socket.write('250 OK queued\r\n');
          } else {
            message.push(line);
          }
          continue;
        }

        const verb = line.split(' ')[0].toUpperCase();
        if (verb === 'EHLO' || verb === 'HELO') socket.write('250-smtp-sink\r\n250 OK\r\n');
        else if (verb === 'MAIL' || verb === 'RCPT' || verb === 'RSET' || verb === 'NOOP') socket.write('250 OK\r\n');
        else if (verb === 'DATA') {
          inData = true;
          socket.write('354 End data with <CR><LF>.<CR><LF>\r\n');
        } else if (verb === 'QUIT') {
          socket.write('221 Bye\r\n');
          socket.end();
        } else if (line.length) socket.write('250 OK\r\n');
      }
    });

    // A client hanging up mid-conversation is normal here, not an error.
    socket.on('error', () => {});
  })
  .listen(PORT, '127.0.0.1', () => console.log(`smtp-sink listening on 127.0.0.1:${PORT}`));
