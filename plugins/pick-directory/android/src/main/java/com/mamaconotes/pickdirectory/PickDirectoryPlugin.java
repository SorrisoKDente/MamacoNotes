package com.mamaconotes.pickdirectory;

import android.content.Intent;
import android.net.Uri;
import android.util.Base64;

import androidx.activity.result.ActivityResult;
import androidx.documentfile.provider.DocumentFile;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.Arrays;
import java.util.HashMap;
import java.util.Iterator;
import java.util.Map;

@CapacitorPlugin(name = "PickDirectory")
public class PickDirectoryPlugin extends Plugin {

    private final Map<String, HttpURLConnection> uploadSessions = new HashMap<>();

    @PluginMethod
    public void pick(PluginCall call) {
        Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT_TREE);
        startActivityForResult(call, intent, "pickResult");
    }

    @ActivityCallback
    private void pickResult(PluginCall call, ActivityResult result) {
        if (result.getResultCode() != android.app.Activity.RESULT_OK) {
            call.reject("Directory selection cancelled");
            return;
        }
        Intent data = result.getData();
        if (data == null || data.getData() == null) {
            call.reject("No directory selected");
            return;
        }
        Uri uri = data.getData();
        try {
            getContext().getContentResolver().takePersistableUriPermission(
                uri,
                Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION
            );
        } catch (SecurityException ignored) {
            // Permission grant may already be held; continue anyway.
        }
        JSObject ret = new JSObject();
        ret.put("path", uri.toString());
        call.resolve(ret);
    }

    @PluginMethod
    public void writeChunk(PluginCall call) {
        String uriString = call.getString("uri");
        String filename = call.getString("filename");
        String content = call.getString("content");
        Boolean append = call.getBoolean("append", false);

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
            if (file == null) {
                call.reject("Failed to create file");
                return;
            }

            // "wt" truncates and writes the first chunk; "wa" appends the rest.
            String mode = (append != null && append) ? "wa" : "wt";
            OutputStream os = getContext().getContentResolver().openOutputStream(file.getUri(), mode);
            if (os == null) {
                call.reject("Failed to open output stream");
                return;
            }
            try {
                os.write(content.getBytes(StandardCharsets.UTF_8));
            } finally {
                os.close();
            }
            call.resolve();
        } catch (Exception e) {
            call.reject(e.getMessage());
        }
    }

    @PluginMethod
    public void readChunk(PluginCall call) {
        String uriString = call.getString("uri");
        String filename = call.getString("filename");
        Integer offset = call.getInt("offset", 0);
        Integer length = call.getInt("length", 512 * 1024);

        if (uriString == null || filename == null) {
            call.reject("Missing parameters");
            return;
        }

        try {
            Uri rootUri = Uri.parse(uriString);
            DocumentFile rootDir = DocumentFile.fromTreeUri(getContext(), rootUri);
            if (rootDir == null) {
                call.reject("Cannot access directory");
                return;
            }

            DocumentFile file = rootDir.findFile(filename);
            if (file == null) {
                call.reject("File not found");
                return;
            }

            byte[] data = readFromUri(file.getUri(), offset, length);

            JSObject ret = new JSObject();
            ret.put("data", Base64.encodeToString(data, Base64.NO_WRAP));
            ret.put("end", data.length < length);
            call.resolve(ret);
        } catch (Exception e) {
            call.reject(e.getMessage());
        }
    }

    @PluginMethod
    public void openFilePicker(PluginCall call) {
        Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT);
        intent.addCategory(Intent.CATEGORY_OPENABLE);
        intent.setType("application/json");
        intent.putExtra(Intent.EXTRA_TITLE, "mamaco-notes-backup.json");
        startActivityForResult(call, intent, "openFilePickerResult");
    }

    @ActivityCallback
    private void openFilePickerResult(PluginCall call, ActivityResult result) {
        if (result.getResultCode() != android.app.Activity.RESULT_OK) {
            call.reject("File selection cancelled");
            return;
        }
        Intent data = result.getData();
        if (data == null || data.getData() == null) {
            call.reject("No file selected");
            return;
        }
        JSObject ret = new JSObject();
        ret.put("uri", data.getData().toString());
        call.resolve(ret);
    }

    @PluginMethod
    public void readUriChunk(PluginCall call) {
        String uriString = call.getString("uri");
        Integer offset = call.getInt("offset", 0);
        Integer length = call.getInt("length", 512 * 1024);

        if (uriString == null) {
            call.reject("Missing parameters");
            return;
        }

        try {
            byte[] data = readFromUri(Uri.parse(uriString), offset, length);
            JSObject ret = new JSObject();
            ret.put("data", Base64.encodeToString(data, Base64.NO_WRAP));
            ret.put("end", data.length < length);
            call.resolve(ret);
        } catch (Exception e) {
            call.reject(e.getMessage());
        }
    }

    @PluginMethod
    public void getUriFileInfo(PluginCall call) {
        String uriString = call.getString("uri");

        if (uriString == null) {
            call.reject("Missing parameters");
            return;
        }

        try {
            Uri uri = Uri.parse(uriString);
            DocumentFile file = DocumentFile.fromSingleUri(getContext(), uri);
            if (file == null) {
                call.reject("File not found");
                return;
            }
            JSObject ret = new JSObject();
            ret.put("size", file.length());
            call.resolve(ret);
        } catch (Exception e) {
            call.reject(e.getMessage());
        }
    }

    @PluginMethod
    public void getFileInfo(PluginCall call) {
        String uriString = call.getString("uri");
        String filename = call.getString("filename");

        if (uriString == null || filename == null) {
            call.reject("Missing parameters");
            return;
        }

        try {
            Uri rootUri = Uri.parse(uriString);
            DocumentFile rootDir = DocumentFile.fromTreeUri(getContext(), rootUri);
            if (rootDir == null) {
                call.reject("Cannot access directory");
                return;
            }

            DocumentFile file = rootDir.findFile(filename);
            if (file == null) {
                call.reject("File not found");
                return;
            }

            JSObject ret = new JSObject();
            ret.put("size", file.length());
            call.resolve(ret);
        } catch (Exception e) {
            call.reject(e.getMessage());
        }
    }

    @PluginMethod
    public void uploadStart(PluginCall call) {
        String sessionId = call.getString("sessionId");
        String url = call.getString("url");
        JSObject headers = call.getObject("headers");
        Integer totalLength = call.getInt("totalLength", 0);

        if (sessionId == null || url == null) {
            call.reject("Missing parameters");
            return;
        }

        try {
            HttpURLConnection conn = (HttpURLConnection) new URL(url).openConnection();
            conn.setRequestMethod("PUT");
            conn.setDoOutput(true);
            conn.setConnectTimeout(30000);
            conn.setReadTimeout(120000);
            if (totalLength != null && totalLength > 0) {
                conn.setFixedLengthStreamingMode(totalLength);
            } else {
                conn.setChunkedStreamingMode(64 * 1024);
            }
            if (headers != null) {
                Iterator<String> keys = headers.keys();
                while (keys.hasNext()) {
                    String key = keys.next();
                    conn.setRequestProperty(key, headers.getString(key));
                }
            }
            conn.connect();
            uploadSessions.put(sessionId, conn);
            call.resolve();
        } catch (Exception e) {
            call.reject(e.getMessage());
        }
    }

    @PluginMethod
    public void uploadChunk(PluginCall call) {
        String sessionId = call.getString("sessionId");
        String content = call.getString("content");

        if (sessionId == null || content == null) {
            call.reject("Missing parameters");
            return;
        }

        HttpURLConnection conn = uploadSessions.get(sessionId);
        if (conn == null) {
            call.reject("No upload session");
            return;
        }

        try {
            OutputStream os = conn.getOutputStream();
            os.write(content.getBytes(StandardCharsets.UTF_8));
            os.flush();
            call.resolve();
        } catch (Exception e) {
            uploadSessions.remove(sessionId);
            conn.disconnect();
            call.reject(e.getMessage());
        }
    }

    @PluginMethod
    public void uploadEnd(PluginCall call) {
        String sessionId = call.getString("sessionId");
        if (sessionId == null) {
            call.reject("Missing parameters");
            return;
        }

        HttpURLConnection conn = uploadSessions.remove(sessionId);
        if (conn == null) {
            call.reject("No upload session");
            return;
        }

        try {
            OutputStream os = conn.getOutputStream();
            os.close();
            int code = conn.getResponseCode();
            if (code >= 200 && code < 300) {
                JSObject ret = new JSObject();
                ret.put("status", code);
                call.resolve(ret);
            } else {
                call.reject("Upload failed with status " + code);
            }
        } catch (Exception e) {
            call.reject(e.getMessage());
        } finally {
            conn.disconnect();
        }
    }

    private byte[] readFromUri(Uri uri, int offset, int length) throws IOException {        InputStream is = getContext().getContentResolver().openInputStream(uri);
        if (is == null) {
            return new byte[0];
        }
        try {
            skipFully(is, offset);
            byte[] buffer = new byte[length];
            int total = 0;
            int read;
            while (total < length && (read = is.read(buffer, total, length - total)) != -1) {
                total += read;
            }
            return total == 0 ? new byte[0] : Arrays.copyOf(buffer, total);
        } finally {
            is.close();
        }
    }

    private static void skipFully(InputStream is, long bytes) throws IOException {
        long remaining = bytes;
        while (remaining > 0) {
            long skipped = is.skip(remaining);
            if (skipped <= 0) {
                if (is.read() == -1) {
                    return;
                }
                remaining--;
            } else {
                remaining -= skipped;
            }
        }
    }
}
