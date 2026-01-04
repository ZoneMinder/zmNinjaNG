import { describe, it, expect, vi, beforeEach } from 'vitest';
import { downloadFile } from '../download';
import { Platform } from '../platform';

// Mock dependencies
vi.mock('../logger', () => ({
    log: {
        download: vi.fn(),
    },
    LogLevel: {
        INFO: 'INFO',
        ERROR: 'ERROR',
        WARN: 'WARN',
        DEBUG: 'DEBUG',
    },
}));

vi.mock('../platform', () => ({
    Platform: {
        isNative: true,
        isTauri: false,
        isWeb: false,
    },
}));

// Mock Capacitor dynamic imports
vi.mock('@capacitor/core', () => ({
    CapacitorHttp: {
        request: vi.fn().mockResolvedValue({
            status: 200,
            data: 'base64_encoded_video_data',
            headers: { 'content-type': 'video/mp4' },
        }),
    },
}));

vi.mock('@capacitor/filesystem', () => ({
    Filesystem: {
        writeFile: vi.fn().mockResolvedValue({ uri: 'file:///documents/test.mp4' }),
        Directory: {
            Documents: 'DOCUMENTS',
            Cache: 'CACHE',
        },
    },
    Directory: { Documents: 'DOCUMENTS', Cache: 'CACHE' }
}));

vi.mock('@capacitor-community/media', () => ({
    Media: {
        savePhoto: vi.fn(),
        saveVideo: vi.fn(),
    },
}));

describe('Mobile Download Logic', () => {
    beforeEach(async () => {
        vi.clearAllMocks();
        // Reset platform to native
        (Platform as any).isNative = true;
        (Platform as any).isTauri = false;
    });

    it('should download file using CapacitorHttp on mobile', async () => {
        const onProgress = vi.fn();

        // Trigger the download
        await downloadFile('http://example.com/video.mp4', 'test_video.mp4', { onProgress });

        // Get mocked modules
        const { CapacitorHttp } = await import('@capacitor/core');
        const { Filesystem } = await import('@capacitor/filesystem');
        const { Media } = await import('@capacitor-community/media');

        // Verify CapacitorHttp was called
        expect(CapacitorHttp.request).toHaveBeenCalledWith({
            method: 'GET',
            url: 'http://example.com/video.mp4',
            responseType: 'blob',
        });

        // Verify file was written to documents with base64 data
        expect(Filesystem.writeFile).toHaveBeenCalledWith({
            path: 'test_video.mp4',
            directory: 'DOCUMENTS',
            data: 'base64_encoded_video_data',
        });

        // Verify media library save was attempted
        expect(Media.saveVideo).toHaveBeenCalledWith({
            path: 'file:///documents/test.mp4'
        });
    });
});
