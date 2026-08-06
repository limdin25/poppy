"use client";

import { useRef, useState } from "react";
import { CheckCircle, Loader2, Upload } from "lucide-react";
import { createMediaUploadUrl } from "@/lib/actions/media";
import { createClient } from "@/lib/supabase/client";

const MAX_IMAGE_BYTES = 8 * 1024 * 1024; // Instagram: images up to 8MB
const MAX_VIDEO_BYTES = 100 * 1024 * 1024; // Instagram: videos up to 100MB

// Drag & drop / click-to-pick post media. The file goes from the browser
// straight to Supabase Storage via a one-time signed URL (no server limits),
// and the resulting public URL is handed to the caller's media_url field.
export function MediaUpload({ onUploaded }: { onUploaded: (url: string) => void }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [fileName, setFileName] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);

  const handleFile = async (file: File) => {
    setError(null);
    setFileName(null);

    const isVideo = file.type.startsWith("video/");
    const max = isVideo ? MAX_VIDEO_BYTES : MAX_IMAGE_BYTES;
    if (file.size > max) {
      setError(
        `File too large. Instagram accepts ${isVideo ? "videos up to 100MB" : "images up to 8MB"}.`,
      );
      return;
    }

    setUploading(true);
    try {
      const r = await createMediaUploadUrl(file.name, file.type);
      if ("error" in r) {
        setError(r.error);
        return;
      }

      const supabase = createClient();
      const { error: upErr } = await supabase.storage
        .from("media")
        .uploadToSignedUrl(r.path, r.token, file);
      if (upErr) {
        setError(`Upload failed: ${upErr.message}`);
        return;
      }

      setFileName(file.name);
      onUploaded(r.publicUrl);
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="flex flex-col gap-1">
      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png,video/mp4,video/quicktime"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void handleFile(f);
          e.target.value = "";
        }}
      />
      <button
        type="button"
        disabled={uploading}
        onClick={() => inputRef.current?.click()}
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          const f = e.dataTransfer.files?.[0];
          if (f) void handleFile(f);
        }}
        className={`rounded-lg border-2 border-dashed p-6 text-center transition-colors ${
          dragOver ? "border-accent bg-accent/5" : "border-border"
        } ${uploading ? "opacity-60" : "hover:border-accent/60"}`}
      >
        {uploading ? (
          <span className="inline-flex items-center gap-2 text-sm text-foreground-secondary">
            <Loader2 size={18} className="animate-spin" /> Uploading...
          </span>
        ) : fileName ? (
          <span className="inline-flex items-center gap-2 text-sm text-success">
            <CheckCircle size={18} /> {fileName} uploaded!
          </span>
        ) : (
          <span className="flex flex-col items-center gap-1 text-sm text-foreground-secondary">
            <Upload size={20} />
            Drag media here or click to upload
            <span className="text-xs">JPG/PNG up to 8MB, MP4/MOV up to 100MB</span>
          </span>
        )}
      </button>
      {error && <p className="text-sm text-error">{error}</p>}
    </div>
  );
}
