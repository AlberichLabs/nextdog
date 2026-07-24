// NextDog quick-start, step 1 of 2: wrap your Next.js config.
// In development this registers the sidecar bootstrap + telemetry env; in any
// other NODE_ENV it returns the config unchanged (NextDog is fully inert).
import { withNextDog } from '@nextdog/next';

/** @type {import('next').NextConfig} */
const nextConfig = {
  // your existing Next.js config goes here
};

// `url` normally defaults to http://localhost:6789. Honoring NEXTDOG_URL when it
// is set lets the debug-loop e2e test point this app at an isolated sidecar on a
// scratch port; unset (the normal case) it stays the default.
export default withNextDog(nextConfig, {
  serviceName: 'example-next',
  url: process.env.NEXTDOG_URL,
});
