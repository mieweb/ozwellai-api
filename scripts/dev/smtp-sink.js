#!/usr/bin/env node

/**
 * Throwaway SMTP server for testing widget sign-in emails locally.
 *
 * Accepts any message and prints it. Nothing is delivered, so no real address
 * ever receives anything.
 *
 * The MIE relay that carries these codes in production only answers from
 * inside the Phoenix DC — `relay.cluster.mieweb.org` does not even resolve
 * elsewhere — so this stands in for it during development.
 *
 *   node scripts/dev/smtp-sink.js 2525
 *   SMTP_URL=smtp://127.0.0.1:2525 ./scripts/start.sh
 *
 * With a sender configured the code stops appearing in the server log and
 * AUTH_DEV_ECHO_OTP is ignored, which is exactly how a deployed server
 * behaves — so this exercises the real path, not the dev shortcut. Read the
 * code off this script's output instead.
 */

import net from 'node:net';

const PORT = Number(process.argv[2] || 2525);

net
  .createServer((socket) => {
    let inData = false;
    let message = [];

    socket.write('220 smtp-sink ready\r\n');

    socket.on('data', (chunk) => {
      for (const line of chunk.toString('utf8').split('\r\n')) {
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
