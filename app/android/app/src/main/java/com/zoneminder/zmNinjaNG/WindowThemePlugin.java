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

    @PluginMethod
    public void setBackgroundColor(PluginCall call) {
        String hex = call.getString("color");
        if (hex == null || hex.isEmpty()) {
            call.reject("color required");
            return;
        }
        try {
            int color = Color.parseColor(hex);
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
