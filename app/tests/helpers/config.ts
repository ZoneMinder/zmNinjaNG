import * as dotenv from 'dotenv';
import path from 'path';

// Load environment variables
dotenv.config({ path: path.resolve(process.cwd(), '.env') });

/**
 * Test configuration loaded from .env file
 */
export const testConfig = {
  server: {
    host: process.env.ZM_HOST_1 || 'https://demo.zoneminder.com',
    username: process.env.ZM_USER_1 || '',
    password: process.env.ZM_PASSWORD_1 || '',
  },
  timeouts: {
    transition: 5000, // Max time for page loads/transitions
    element: 3000,    // Max time to wait for elements
    short: 1000,      // Short waits
  },
};

export function getServerConfig() {
  return testConfig.server;
}
