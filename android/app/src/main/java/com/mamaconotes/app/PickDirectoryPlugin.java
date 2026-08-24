package com.mamaconotes.app;

import android.content.Intent;
import android.net.Uri;
import androidx.activity.result.ActivityResult;
import androidx.documentfile.provider.DocumentFile;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.OutputStream;

@CapacitorPlugin(name = "PickDirectory")
public class PickDirectoryPlugin extends Plugin {

    @PluginMethod
    public void pick(PluginCall call) {
        Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT_TREE);
        startActivityForResult(call, intent, "pickResult");
    }

    @PluginMethod
    public void saveFilePicker(PluginCall call) {
        String filename = call.getString("filename");
        Intent intent = new Intent(Intent.ACTION_CREATE_DOCUMENT);
        intent.addCategory(Intent.CATEGORY_OPENABLE);
        intent.setType("application/json");
        intent.putExtra(Intent.EXTRA_TITLE, filename);
        startActivityForResult(call, intent, "saveFilePickerResult");
    }

    @ActivityCallback
    @SuppressWarnings("unused")
    private void pickResult(PluginCall call, ActivityResult result) {
        if (result.getResultCode() == android.app.Activity.RESULT_OK) {
            Intent data = result.getData();
            if (data != null) {
                Uri uri = data.getData();
                if (uri != null) {
                    getContext().getContentResolver().takePersistableUriPermission(
                        uri, 
                        Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION
                    );
                    
                    JSObject ret = new JSObject();
                    ret.put("path", uri.toString());
                    call.resolve(ret);
                } else {
                    call.reject("No directory selected");
                }
            } else {
                call.reject("No directory data received");
            }
        } else {
            call.reject("Directory selection cancelled");
        }
    }

    @ActivityCallback
    @SuppressWarnings("unused")
    private void saveFilePickerResult(PluginCall call, ActivityResult result) {
        if (result.getResultCode() == android.app.Activity.RESULT_OK) {
            Intent data = result.getData();
            if (data != null) {
                Uri uri = data.getData();
                if (uri != null) {
                    JSObject ret = new JSObject();
                    ret.put("uri", uri.toString());
                    call.resolve(ret);
                } else {
                    call.reject("No file location selected");
                }
            } else {
                call.reject("No file data received");
            }
        } else {
            call.reject("File saving cancelled");
        }
    }

    @PluginMethod
    public void writeToUri(PluginCall call) {
        String uriString = call.getString("uri");
        String content = call.getString("content");

        if (uriString == null || content == null) {
            call.reject("Missing parameters");
            return;
        }

        try {
            Uri uri = Uri.parse(uriString);
            OutputStream os = getContext().getContentResolver().openOutputStream(uri);
            if (os != null) {
                os.write(content.getBytes());
                os.close();
                call.resolve();
            } else {
                call.reject("Failed to open output stream");
            }
        } catch (Exception e) {
            call.reject(e.getMessage());
        }
    }

    @PluginMethod
    public void writeFile(PluginCall call) {
        String uriString = call.getString("uri");
        String filename = call.getString("filename");
        String content = call.getString("content");

        if (uriString == null || filename == null || content == null) {
            call.reject("Missing parameters");
            return;
        }

        try {
            Uri rootUri = Uri.parse(uriString);
            DocumentFile rootDir = DocumentFile.fromTreeUri(getContext(), rootUri);
            if (rootDir == null || !rootDir.canWrite()) {
                call.reject("Cannot write to directory");
                return;
            }

            DocumentFile file = rootDir.findFile(filename);
            if (file == null) {
                file = rootDir.createFile("application/json", filename);
            }

            if (file != null) {
                OutputStream os = getContext().getContentResolver().openOutputStream(file.getUri());
                if (os != null) {
                    os.write(content.getBytes());
                    os.close();
                    call.resolve();
                } else {
                    call.reject("Failed to open output stream");
                }
            } else {
                call.reject("Failed to create file");
            }
        } catch (Exception e) {
            call.reject(e.getMessage());
        }
    }
}
