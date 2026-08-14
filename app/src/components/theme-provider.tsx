/**
 * Theme Provider Component
 *
 * Manages the application's theme (light, dark, system) using React Context.
 * Persists the theme preference to localStorage and applies the corresponding
 * CSS class to the document root.
 */

import { createContext, useContext, useEffect, useMemo, useState, useCallback } from "react"
import { useProfileStore } from '../stores/profile';
import { useSettingsStore, type ThemePreference } from '../stores/settings';
import { syncNativeWindowBackground, syncNativeSystemBarsStyle } from '../lib/native-window-theme';

type Theme = ThemePreference

type ThemeProviderProps = {
    children: React.ReactNode
    defaultTheme?: Theme
}

type ThemeProviderState = {
    theme: Theme
    setTheme: (theme: Theme) => void
}

const initialState: ThemeProviderState = {
    theme: "system",
    setTheme: () => null,
}

const ThemeProviderContext = createContext<ThemeProviderState>(initialState)

/**
 * ThemeProvider component that wraps the application to provide theme context.
 *
 * @param props - Component properties
 * @param props.children - Child components
 * @param props.defaultTheme - Default theme to use if not stored (default: "system")
 * @param props.storageKey - Key to use for localStorage (default: "vite-ui-theme")
 */
export function ThemeProvider({
    children,
    defaultTheme = "system",
}: ThemeProviderProps) {
    const currentProfileId = useProfileStore((state) => state.currentProfileId);
    // Select theme directly from profileSettings to avoid calling getProfileSettings()
    // which creates a new object on each call and causes infinite re-renders
    const profileTheme = useSettingsStore(
        (state) => (currentProfileId ? state.profileSettings[currentProfileId]?.theme : undefined)
    );
    const updateProfileSettings = useSettingsStore((state) => state.updateProfileSettings);
    // The profile's theme is the source of truth whenever there is a profile.
    // localTheme only holds the choice before one exists (the login screen),
    // where updateProfileSettings has nowhere to write. Deriving instead of
    // mirroring the store into state through an effect drops a render pass on
    // every profile switch, which showed as a flash of the previous theme
    // (refs #281).
    const [localTheme, setLocalTheme] = useState<Theme>(defaultTheme);
    const theme = profileTheme ?? localTheme;

    useEffect(() => {
        const root = window.document.documentElement

        root.classList.remove("light", "dark", "slate", "amber", "cream")

        if (theme === "system") {
            const systemTheme = window.matchMedia("(prefers-color-scheme: dark)")
                .matches
                ? "dark"
                : "light"

            root.classList.add(systemTheme)
        } else if (theme === "slate" || theme === "amber") {
            root.classList.add("dark", theme)
        } else {
            root.classList.add(theme)
        }

        // Both syncs must also run for the "system" branch: a previously set
        // explicit bar style or window background does not revert when the
        // user switches back to "system" (refs #356).
        //
        // Order matters. SystemBars.setStyle ends by repainting the decor view
        // with the Android theme's windowBackground, which follows the OS night
        // mode, not the app theme. Running it after the background sync would
        // discard the colour WindowTheme just applied and show, for example, a
        // white decor behind a dark app during rotation or overscroll.
        syncNativeSystemBarsStyle()
        syncNativeWindowBackground()
    }, [theme])

    const handleSetTheme = useCallback((newTheme: Theme) => {
        setLocalTheme(newTheme)
        if (currentProfileId) {
            updateProfileSettings(currentProfileId, { theme: newTheme });
        }
    }, [currentProfileId, updateProfileSettings]);

    const value = useMemo(() => ({
        theme,
        setTheme: handleSetTheme,
    }), [theme, handleSetTheme]);

    return (
        <ThemeProviderContext.Provider {...value} value={value}>
            {children}
        </ThemeProviderContext.Provider>
    )
}

/**
 * Hook to access the theme context.
 *
 * @returns The current theme state and setter
 * @throws Error if used outside of a ThemeProvider
 */
export const useTheme = () => {
    const context = useContext(ThemeProviderContext)

    if (context === undefined)
        throw new Error("useTheme must be used within a ThemeProvider")

    return context
}
