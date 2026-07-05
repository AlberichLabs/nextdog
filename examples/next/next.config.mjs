// NextDog quick-start, step 1 of 2: wrap your Next.js config.
// In development this registers the sidecar bootstrap + telemetry env; in any
// other NODE_ENV it returns the config unchanged (NextDog is fully inert).
import { withNextDog } from '@nextdog/next';

/** @type {import('next').NextConfig} */
const nextConfig = {
  // your existing Next.js config goes here
};

export default withNextDog(nextConfig, { serviceName: 'example-next' });
