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
    transition: 5000,   // Max time for page loads/transitions
    element: 3000,      // Max time to wait for elements
    elementVisible: 5000, // Max time to wait for an element to become visible
    short: 1000,        // Short waits
    // Max time for a full page data load (e.g. initial API fetch on navigation,
    // or a multi-hop network flow like profile discovery + login). Referenced
    // widely across tests/steps/*.ts; was missing here, which silently fell
    // back to Playwright's ~5s default assertion timeout instead of the
    // intended longer wait (refs #217).
    pageLoad: 15000,
  },
};

export function getServerConfig() {
  return testConfig.server;
}
