package com.zoneminder.zmNinjaNG;

import android.graphics.Color;
import android.graphics.drawable.ColorDrawable;
import android.view.Window;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "WindowTheme")
public class WindowThemePlugin extends Plugin {

    /**
     * The colour the web layer last asked for, kept so a configuration change
     * can restore it. SystemBars.setStyle ends by repainting the decor view
     * with the Android theme's windowBackground, and it re-applies its tracked
     * style on every configuration change, so a rotation otherwise leaves the
     * window painted in the OS night mode's colour - white behind a dark app
     * on a light system theme, visible while the WebView resizes (refs #356).
     *
     * Static because the value has to survive the activity being recreated,
     * where the web layer's theme effect does not re-run.
     */
    private static Integer lastColor = null;

    /** Re-applies the last colour the web layer set, if there is one. */
    static void reapply(Window window) {
        if (lastColor != null) {
            window.setBackgroundDrawable(new ColorDrawable(lastColor));
        }
    }

    @PluginMethod
    public void setBackgroundColor(PluginCall call) {
        String hex = call.getString("color");
        if (hex == null || hex.isEmpty()) {
            call.reject("color required");
            return;
        }
        try {
            int color = Color.parseColor(hex);
            lastColor = color;
            // Bar icon appearance is owned by the core SystemBars plugin
            // (driven from syncNativeSystemBarsStyle in the web layer).
            // Setting it here via the insets controller bypasses SystemBars'
            // tracked style, which re-applies on every configuration change
            // and stomps the direct call (refs #356).
            getActivity().runOnUiThread(() -> {
                Window window = getActivity().getWindow();
                window.setBackgroundDrawable(new ColorDrawable(color));
            });
            call.resolve();
        } catch (IllegalArgumentException e) {
            call.reject("Invalid color: " + hex, e);
        }
    }
}
