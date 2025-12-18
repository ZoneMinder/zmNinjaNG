/**
 * Unit tests for URL derivation utilities
 */

import { describe, it, expect } from 'vitest';
import { deriveZoneminderUrls, discoverApiUrl } from '../urls';

describe('deriveZoneminderUrls', () => {
  describe('HTTPS URLs (default)', () => {
    it('derives patterns for HTTPS URL', () => {
      const result = deriveZoneminderUrls('https://example.com');

      expect(result.apiPatterns).toEqual([
        'https://example.com/api',
        'https://example.com/zm/api',
        'http://example.com/api',
        'http://example.com/zm/api',
      ]);
    });

    it('derives patterns for HTTPS URL with /zm path', () => {
      const result = deriveZoneminderUrls('https://example.com/zm');

      expect(result.apiPatterns).toEqual([
        'https://example.com/zm/api',
        'https://example.com/zm/zm/api',
        'http://example.com/zm/api',
        'http://example.com/zm/zm/api',
      ]);
    });

    it('derives patterns for HTTPS URL with custom path', () => {
      const result = deriveZoneminderUrls('https://example.com/custom');

      expect(result.apiPatterns).toEqual([
        'https://example.com/custom/api',
        'https://example.com/custom/zm/api',
        'http://example.com/custom/api',
        'http://example.com/custom/zm/api',
      ]);
    });

    it('derives patterns for HTTPS URL with port', () => {
      const result = deriveZoneminderUrls('https://example.com:8443');

      expect(result.apiPatterns).toEqual([
        'https://example.com:8443/api',
        'https://example.com:8443/zm/api',
        'http://example.com:8443/api',
        'http://example.com:8443/zm/api',
      ]);
    });
  });

  describe('HTTP URLs', () => {
    it('derives patterns for HTTP URL', () => {
      const result = deriveZoneminderUrls('http://example.com');

      expect(result.apiPatterns).toEqual([
        'http://example.com/api',
        'http://example.com/zm/api',
        'https://example.com/api',
        'https://example.com/zm/api',
      ]);
    });

    it('derives patterns for HTTP URL with /zm path', () => {
      const result = deriveZoneminderUrls('http://example.com/zm');

      expect(result.apiPatterns).toEqual([
        'http://example.com/zm/api',
        'http://example.com/zm/zm/api',
        'https://example.com/zm/api',
        'https://example.com/zm/zm/api',
      ]);
    });

    it('tries HTTP first when user specifies it', () => {
      const result = deriveZoneminderUrls('http://example.com');

      // First pattern should be http
      expect(result.apiPatterns[0]).toContain('http://');
      // Third pattern should be https (alternate)
      expect(result.apiPatterns[2]).toContain('https://');
    });
  });

  describe('URL normalization', () => {
    it('removes trailing slash', () => {
      const result = deriveZoneminderUrls('https://example.com/');

      expect(result.apiPatterns[0]).toBe('https://example.com/api');
    });

    it('removes trailing slash from path', () => {
      const result = deriveZoneminderUrls('https://example.com/zm/');

      expect(result.apiPatterns[0]).toBe('https://example.com/zm/api');
    });

    it('handles multiple trailing slashes', () => {
      const result = deriveZoneminderUrls('https://example.com///');

      // Only removes last trailing slash (regex /\/$/ only matches one)
      expect(result.apiPatterns[0]).toBe('https://example.com///api');
    });
  });

  describe('URLs without protocol', () => {
    it('defaults to HTTPS when no protocol specified', () => {
      const result = deriveZoneminderUrls('example.com');

      expect(result.apiPatterns[0]).toBe('https://example.com/api');
      expect(result.apiPatterns[2]).toBe('http://example.com/api');
    });
  });

  describe('CGI patterns', () => {
    it('derives CGI patterns for URL ending in /zm', () => {
      const result = deriveZoneminderUrls('https://example.com/zm');

      expect(result.cgiPatterns).toEqual([
        'https://example.com/zm/cgi-bin',
        'https://example.com/zm/cgi-bin-zm',
        'https://example.com/zm/zmcgi',
        'http://example.com/zm/cgi-bin',
        'http://example.com/zm/cgi-bin-zm',
        'http://example.com/zm/zmcgi',
      ]);
    });

    it('derives CGI patterns for root URL', () => {
      const result = deriveZoneminderUrls('https://example.com');

      expect(result.cgiPatterns).toEqual([
        'https://example.com/zm/cgi-bin',
        'https://example.com/cgi-bin',
        'https://example.com/cgi-bin-zm',
        'https://example.com/zmcgi',
        'http://example.com/zm/cgi-bin',
        'http://example.com/cgi-bin',
        'http://example.com/cgi-bin-zm',
        'http://example.com/zmcgi',
      ]);
    });

    it('derives CGI patterns for custom path', () => {
      const result = deriveZoneminderUrls('https://example.com/custom');

      expect(result.cgiPatterns).toEqual([
        'https://example.com/custom/zm/cgi-bin',
        'https://example.com/custom/cgi-bin',
        'https://example.com/custom/cgi-bin-zm',
        'https://example.com/custom/zmcgi',
        'http://example.com/custom/zm/cgi-bin',
        'http://example.com/custom/cgi-bin',
        'http://example.com/custom/cgi-bin-zm',
        'http://example.com/custom/zmcgi',
      ]);
    });

    it('includes alternate protocol CGI patterns', () => {
      const result = deriveZoneminderUrls('http://example.com');

      // Should have patterns for both http (primary) and https (alternate)
      expect(result.cgiPatterns.some(p => p.startsWith('http://'))).toBe(true);
      expect(result.cgiPatterns.some(p => p.startsWith('https://'))).toBe(true);
    });
  });

  describe('Protocol priority', () => {
    it('prioritizes HTTPS when specified', () => {
      const result = deriveZoneminderUrls('https://example.com');

      expect(result.apiPatterns[0]).toContain('https://');
      expect(result.apiPatterns[1]).toContain('https://');
      expect(result.apiPatterns[2]).toContain('http://');
    });

    it('prioritizes HTTP when specified', () => {
      const result = deriveZoneminderUrls('http://example.com');

      expect(result.apiPatterns[0]).toContain('http://');
      expect(result.apiPatterns[1]).toContain('http://');
      expect(result.apiPatterns[2]).toContain('https://');
    });
  });

  describe('Complex URLs', () => {
    it('handles subdomain', () => {
      const result = deriveZoneminderUrls('https://zm.example.com');

      expect(result.apiPatterns[0]).toBe('https://zm.example.com/api');
    });

    it('handles IP address', () => {
      const result = deriveZoneminderUrls('https://192.168.1.100');

      expect(result.apiPatterns[0]).toBe('https://192.168.1.100/api');
    });

    it('handles IP with port', () => {
      const result = deriveZoneminderUrls('http://192.168.1.100:8080');

      expect(result.apiPatterns[0]).toBe('http://192.168.1.100:8080/api');
    });

    it('handles localhost', () => {
      const result = deriveZoneminderUrls('http://localhost');

      expect(result.apiPatterns[0]).toBe('http://localhost/api');
    });

    it('handles localhost with port', () => {
      const result = deriveZoneminderUrls('http://localhost:8080');

      expect(result.apiPatterns[0]).toBe('http://localhost:8080/api');
    });

    it('handles deep path', () => {
      const result = deriveZoneminderUrls('https://example.com/security/zm');

      expect(result.apiPatterns[0]).toBe('https://example.com/security/zm/api');
    });
  });

  describe('Edge cases', () => {
    it('handles empty string', () => {
      const result = deriveZoneminderUrls('');

      expect(result.apiPatterns).toBeDefined();
      expect(Array.isArray(result.apiPatterns)).toBe(true);
    });

    it('handles URL with query parameters', () => {
      const result = deriveZoneminderUrls('https://example.com?param=value');

      expect(result.apiPatterns[0]).toContain('example.com?param=value/api');
    });

    it('handles URL with hash', () => {
      const result = deriveZoneminderUrls('https://example.com#section');

      expect(result.apiPatterns[0]).toContain('example.com#section/api');
    });
  });
});

describe('discoverApiUrl', () => {
  describe('Success cases', () => {
    it('returns first working URL', async () => {
      const patterns = [
        'https://example.com/api',
        'https://example.com/zm/api',
        'http://example.com/api',
      ];

      const testFn = async (url: string) => {
        if (url === 'https://example.com/api') {
          throw new Error('Not found');
        }
        if (url === 'https://example.com/zm/api') {
          return; // Success
        }
        throw new Error('Not found');
      };

      const result = await discoverApiUrl(patterns, testFn);

      expect(result).toBe('https://example.com/zm/api');
    });

    it('returns first URL if it works', async () => {
      const patterns = [
        'https://example.com/api',
        'https://example.com/zm/api',
      ];

      const testFn = async () => {
        return; // All succeed
      };

      const result = await discoverApiUrl(patterns, testFn);

      expect(result).toBe('https://example.com/api');
    });

    it('tries all patterns until one succeeds', async () => {
      const patterns = [
        'url1',
        'url2',
        'url3',
        'url4',
      ];

      let callCount = 0;
      const testFn = async (url: string) => {
        callCount++;
        if (url === 'url4') {
          return; // Last one succeeds
        }
        throw new Error('Fail');
      };

      const result = await discoverApiUrl(patterns, testFn);

      expect(result).toBe('url4');
      expect(callCount).toBe(4);
    });
  });

  describe('Failure cases', () => {
    it('returns null when all patterns fail', async () => {
      const patterns = [
        'https://example.com/api',
        'https://example.com/zm/api',
      ];

      const testFn = async () => {
        throw new Error('All fail');
      };

      const result = await discoverApiUrl(patterns, testFn);

      expect(result).toBeNull();
    });

    it('returns null for empty patterns array', async () => {
      const patterns: string[] = [];

      const testFn = async () => {
        return;
      };

      const result = await discoverApiUrl(patterns, testFn);

      expect(result).toBeNull();
    });

    it('handles async test function that rejects', async () => {
      const patterns = ['url1', 'url2'];

      const testFn = async () => {
        throw new Error('Async rejection');
      };

      const result = await discoverApiUrl(patterns, testFn);

      expect(result).toBeNull();
    });
  });

  describe('Test function behavior', () => {
    it('calls test function for each pattern', async () => {
      const patterns = ['url1', 'url2', 'url3'];
      const calledUrls: string[] = [];

      const testFn = async (url: string) => {
        calledUrls.push(url);
        if (url === 'url2') {
          return;
        }
        throw new Error('Fail');
      };

      await discoverApiUrl(patterns, testFn);

      expect(calledUrls).toEqual(['url1', 'url2']);
    });

    it('stops calling test function after first success', async () => {
      const patterns = ['url1', 'url2', 'url3', 'url4'];
      let callCount = 0;

      const testFn = async (url: string) => {
        callCount++;
        if (url === 'url2') {
          return;
        }
        throw new Error('Fail');
      };

      await discoverApiUrl(patterns, testFn);

      expect(callCount).toBe(2); // Only url1 and url2 were tested
    });

    it('handles test function that throws different error types', async () => {
      const patterns = ['url1', 'url2', 'url3'];

      const testFn = async (url: string) => {
        if (url === 'url1') {
          throw new Error('Normal error');
        }
        if (url === 'url2') {
          throw 'String error';
        }
        return; // url3 succeeds
      };

      const result = await discoverApiUrl(patterns, testFn);

      expect(result).toBe('url3');
    });
  });

  describe('Integration with deriveZoneminderUrls', () => {
    it('can discover API URL from derived patterns', async () => {
      const derived = deriveZoneminderUrls('https://example.com/zm');

      const testFn = async (url: string) => {
        if (url === 'https://example.com/zm/api') {
          return;
        }
        throw new Error('Not found');
      };

      const result = await discoverApiUrl(derived.apiPatterns, testFn);

      expect(result).toBe('https://example.com/zm/api');
    });

    it('falls back to alternate protocol if primary fails', async () => {
      const derived = deriveZoneminderUrls('https://example.com');

      const testFn = async (url: string) => {
        // HTTPS fails, HTTP works
        if (url.startsWith('https://')) {
          throw new Error('HTTPS not available');
        }
        if (url === 'http://example.com/api') {
          return;
        }
        throw new Error('Not found');
      };

      const result = await discoverApiUrl(derived.apiPatterns, testFn);

      expect(result).toBe('http://example.com/api');
    });

    it('tries /zm path if root fails', async () => {
      const derived = deriveZoneminderUrls('https://example.com');

      const testFn = async (url: string) => {
        if (url === 'https://example.com/zm/api') {
          return;
        }
        throw new Error('Not found');
      };

      const result = await discoverApiUrl(derived.apiPatterns, testFn);

      expect(result).toBe('https://example.com/zm/api');
    });
  });
});
