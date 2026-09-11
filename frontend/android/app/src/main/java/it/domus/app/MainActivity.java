package it.domus.app;

import android.os.Bundle;
import android.view.WindowManager;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        // Il vault decifrato sta sullo schermo: FLAG_SECURE impedisce gli
        // screenshot, la registrazione dello schermo e l'anteprima nel task
        // switcher, dove Android altrimenti congela l'ultimo fotogramma.
        getWindow().setFlags(
            WindowManager.LayoutParams.FLAG_SECURE,
            WindowManager.LayoutParams.FLAG_SECURE
        );
        super.onCreate(savedInstanceState);
    }
}
