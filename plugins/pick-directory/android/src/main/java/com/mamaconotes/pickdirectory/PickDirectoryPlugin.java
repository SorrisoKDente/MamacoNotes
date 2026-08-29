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

@SuppressWarnings("unused")
@CapacitorPlugin(name = "PickDirectory")
public class PickDirectoryPlugin extends Plugin {

    private static class UploadSession {
        final HttpURLConnection connection;
        final OutputStream output;
        long bytesWritten;

        UploadSession(HttpURLConnection connection, OutputStream output) {
            this.connection = connection;
            this.output = output;
            this.bytesWritten = 0;
        }
    }

    private final Map<String, UploadSession> uploadSessions = new HashMap<>();

    @PluginMethod
    @SuppressWarnings("unused")
    public void pick(PluginCall call) {
        Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT_TREE);
        startActivityForResult(call, intent, "pickResult");
    }

    @ActivityCallback
    @SuppressWarnings("unused")
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
    @SuppressWarnings("unused")
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

            DocumentFile existingFile = rootDir.findFile(filename);
            DocumentFile fileToUse = (existingFile != null) ? existingFile : rootDir.createFile("application/json", filename);

            if (fileToUse == null) {
                call.reject("Failed to create or find file");
                return;
            }

            // "wt" truncates and writes the first chunk; "wa" appends the rest.
            String mode = (append != null && append) ? "wa" : "wt";
            try (OutputStream os = getContext().getContentResolver().openOutputStream(fileToUse.getUri(), mode)) {
                if (os == null) {
                    call.reject("Failed to open output stream");
                    return;
                }
                os.write(content.getBytes(StandardCharsets.UTF_8));
            }
            call.resolve();
        } catch (Exception e) {
            call.reject(e.getMessage());
        }
    }

    @PluginMethod
    @SuppressWarnings("unused")
    public void readChunk(PluginCall call) {
        String uriString = call.getString("uri");
        String filename = call.getString("filename");
        Integer offsetParam = call.getInt("offset");
        Integer lengthParam = call.getInt("length");

        int offset = (offsetParam != null) ? offsetParam : 0;
        int length = (lengthParam != null) ? lengthParam : 512 * 1024;

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
    @SuppressWarnings("unused")
    public void openFilePicker(PluginCall call) {
        Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT);
        intent.addCategory(Intent.CATEGORY_OPENABLE);
        intent.setType("application/json");
        intent.putExtra(Intent.EXTRA_TITLE, "mamaco-notes-backup.json");
        startActivityForResult(call, intent, "openFilePickerResult");
    }

    @ActivityCallback
    @SuppressWarnings("unused")
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
    @SuppressWarnings("unused")
    public void readUriChunk(PluginCall call) {
        String uriString = call.getString("uri");
        Integer offsetParam = call.getInt("offset");
        Integer lengthParam = call.getInt("length");

        int offset = (offsetParam != null) ? offsetParam : 0;
        int length = (lengthParam != null) ? lengthParam : 512 * 1024;

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
    @SuppressWarnings("unused")
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
    @SuppressWarnings("unused")
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
    @SuppressWarnings("unused")
    public void uploadStart(PluginCall call) {
        String sessionId = call.getString("sessionId");
        String url = call.getString("url");
        JSObject headers = call.getObject("headers");
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
            // The body is delivered over several Capacitor calls. Chunked
            // transfer avoids committing a possibly stale Content-Length when
            // a bridge call is interrupted and prevents a successful 0-byte
            // WebDAV object from being mistaken for a complete upload.
            conn.setChunkedStreamingMode(64 * 1024);
            if (headers != null) {
                Iterator<String> keys = headers.keys();
                while (keys.hasNext()) {
                    String key = keys.next();
                    conn.setRequestProperty(key, headers.getString(key));
                }
            }
            conn.connect();
            uploadSessions.put(sessionId, new UploadSession(conn, conn.getOutputStream()));
            call.resolve();
        } catch (Exception e) {
            call.reject(e.getMessage());
        }
    }

    @PluginMethod
    @SuppressWarnings("unused")
    public void uploadChunk(PluginCall call) {
        String sessionId = call.getString("sessionId");
        String content = call.getString("content");

        if (sessionId == null || content == null) {
            call.reject("Missing parameters");
            return;
        }

        UploadSession session = uploadSessions.get(sessionId);
        if (session == null) {
            call.reject("No upload session");
            return;
        }

        try {
            byte[] chunk = Base64.decode(content, Base64.DEFAULT);
            session.output.write(chunk);
            session.output.flush();
            session.bytesWritten += chunk.length;
            call.resolve();
        } catch (Exception e) {
            uploadSessions.remove(sessionId);
            try {
                session.output.close();
            } catch (IOException ignored) {
                // The upload is already failing; preserve the original error.
            }
            session.connection.disconnect();
            call.reject(e.getMessage());
        }
    }

    @PluginMethod
    @SuppressWarnings("unused")
    public void uploadEnd(PluginCall call) {
        String sessionId = call.getString("sessionId");
        if (sessionId == null) {
            call.reject("Missing parameters");
            return;
        }

        UploadSession session = uploadSessions.remove(sessionId);
        if (session == null) {
            call.reject("No upload session");
            return;
        }

        try {
            session.output.close();
            int code = session.connection.getResponseCode();
            if (code >= 200 && code < 300) {
                JSObject ret = new JSObject();
                ret.put("status", code);
                ret.put("bytesWritten", session.bytesWritten);
                call.resolve(ret);
            } else {
                call.reject("Upload failed with status " + code);
            }
        } catch (Exception e) {
            call.reject(e.getMessage());
        } finally {
            session.connection.disconnect();
        }
    }

    private byte[] readFromUri(Uri uri, int offset, int length) throws IOException {
        try (InputStream is = getContext().getContentResolver().openInputStream(uri)) {
            if (is == null) {
                return new byte[0];
            }
            skipFully(is, offset);
            byte[] buffer = new byte[length];
            int bytesReadTotal = 0;
            int read;
            while (bytesReadTotal < length && (read = is.read(buffer, bytesReadTotal, length - bytesReadTotal)) != -1) {
                bytesReadTotal += read;
            }
            return bytesReadTotal == 0 ? new byte[0] : Arrays.copyOf(buffer, bytesReadTotal);
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
