import { createApp } from './app.js';
import { errorDetails, writeLog } from './observability.js';
const port = Number(process.env.PORT || 8080);
process.on('warning', (warning) =>
  writeLog({ event: 'runtime_warning', severity: 'WARNING', ...errorDetails(warning) }),
);
process.on('uncaughtExceptionMonitor', (error) =>
  writeLog({ event: 'runtime_crash', severity: 'CRITICAL', ...errorDetails(error) }),
);
const server = createApp().listen(port, '0.0.0.0', () =>
  writeLog({ event: 'startup', severity: 'INFO' }),
);
process.on('SIGTERM', () => server.close(() => process.exit(0)));
