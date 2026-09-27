import { createApp } from './app.js';
const port = Number(process.env.PORT || 8080);
const server = createApp().listen(port, '0.0.0.0', () => console.log(`TripGuessr listening on ${port}`));
process.on('SIGTERM', () => server.close(() => process.exit(0)));
