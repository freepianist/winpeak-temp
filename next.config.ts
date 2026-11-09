import path from 'path';
import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
	outputFileTracingRoot: path.resolve(__dirname),
	serverExternalPackages: ['pg', '@prisma/client', '@prisma/adapter-pg']
};

export default nextConfig;
