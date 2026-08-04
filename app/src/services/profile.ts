import { setSecureValue, getSecureValue, removeSecureValue } from '../lib/security/secureStorage';
import { log, LogLevel } from '../lib/logger';

export const ProfileService = {
    /**
     * Securely save a profile's password.
     */
    async savePassword(profileId: string, password: string): Promise<void> {
        try {
            await setSecureValue(`password_${profileId}`, password);
            log.profile('Password stored securely', LogLevel.INFO, { profileId });
        } catch (error) {
            log.profileService('Failed to store password securely', LogLevel.ERROR, error);
            throw new Error('Failed to securely store password');
        }
    },

    /**
     * Retrieve a profile's password from secure storage.
     */
    async getPassword(profileId: string): Promise<string | undefined> {
        try {
            const password = await getSecureValue(`password_${profileId}`);
            return password || undefined;
        } catch (error) {
            log.profileService('Failed to retrieve password from secure storage', LogLevel.ERROR, error);
            return undefined;
        }
    },

    /**
     * Remove a profile's password from secure storage.
     */
    async deletePassword(profileId: string): Promise<void> {
        try {
            await removeSecureValue(`password_${profileId}`);
            log.profile('Password removed from secure storage', LogLevel.INFO, { profileId });
        } catch (error) {
            log.profileService('Failed to remove password from secure storage', LogLevel.WARN, error);
        }
    },
};
