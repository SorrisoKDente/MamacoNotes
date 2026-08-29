package com.mamaconotes.app;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;
import com.mamaconotes.pickdirectory.PickDirectoryPlugin;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(PickDirectoryPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
