import { setTimeout as delay } from 'node:timers/promises';

export async function waitForServer(server, base, timeoutMs = 30_000) {
  const start = Date.now();
  const deadline = start + timeoutMs;
  let output = '';
  let spawnError;
  let lastProbe = 'No health response';
  const capture = chunk => { output = (output + chunk.toString()).slice(-8192); };
  // Drain both pipes immediately so a verbose child cannot block on stdout.
  server.stdout?.on('data', capture);
  server.stderr?.on('data', capture);
  server.once('error', error => { spawnError = error; });

  const failure = reason => new Error(
    `${reason}: ${base} after ${Date.now() - start}ms ` +
    `(exit=${server.exitCode}, signal=${server.signalCode}).\n` +
    `${lastProbe}\n${output}`
  );

  while (Date.now() < deadline) {
    if (spawnError) throw failure(`Server spawn failed: ${spawnError.message}`);
    if (server.exitCode !== null || server.signalCode !== null) {
      throw failure('Server exited before becoming ready');
    }
    try {
      const response = await fetch(`${base}/health`, {
        signal: AbortSignal.timeout(Math.max(1, Math.min(1000, deadline - Date.now()))),
      });
      await response.arrayBuffer();
      if (response.status === 200) return;
      lastProbe = `Health endpoint returned ${response.status}`;
    } catch (error) {
      lastProbe = error.cause?.message || error.message;
    }
    await delay(Math.max(1, Math.min(200, deadline - Date.now())));
  }
  throw failure('Server did not become ready');
}
