import React, { useEffect, useRef, useState } from 'react';
import { Upload, Trash2, Star, ImageOff, Loader2, X } from 'lucide-react';
import {
  getKontaktBilder,
  uploadKontaktBild,
  deleteKontaktBild,
  setKontaktBildHaupt,
  kontaktBildUrl,
} from '../lib/api.js';

/** Liest eine Datei als base64 (ohne data:URL-Praefix) */
function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result || '';
      const idx = result.indexOf(',');
      resolve(idx >= 0 ? result.substring(idx + 1) : result);
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

export default function KontaktBilder({ kontaktId }) {
  const [bilder, setBilder] = useState([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState(null);
  const [lightbox, setLightbox] = useState(null);
  const fileRef = useRef(null);

  const load = async () => {
    if (!kontaktId) return;
    setLoading(true);
    try {
      const data = await getKontaktBilder(kontaktId);
      setBilder(data);
      setError(null);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, [kontaktId]);

  const handleFile = async (file) => {
    if (!file || !kontaktId) return;
    if (!file.type.startsWith('image/')) {
      setError('Nur Bilddateien erlaubt.');
      return;
    }
    if (file.size > 12 * 1024 * 1024) {
      setError('Datei zu gross (max. 12 MB).');
      return;
    }
    setUploading(true);
    setError(null);
    try {
      const base64 = await fileToBase64(file);
      await uploadKontaktBild(kontaktId, {
        dateiname: file.name,
        mimetype: file.type,
        daten_base64: base64,
      });
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const handleDelete = async (id) => {
    if (!confirm('Bild wirklich loeschen?')) return;
    try {
      await deleteKontaktBild(id);
      await load();
    } catch (err) {
      setError(err.message);
    }
  };

  const handleSetMain = async (id) => {
    try {
      await setKontaktBildHaupt(id);
      await load();
    } catch (err) {
      setError(err.message);
    }
  };

  const haupt = bilder.find((b) => b.ist_hauptbild) || bilder[0];
  const weitere = bilder.filter((b) => b.id !== (haupt && haupt.id));

  return (
    <div>
      <div className="border border-gray-300 rounded-md bg-white p-2">
        {loading ? (
          <div className="flex items-center justify-center h-40 text-gray-400">
            <Loader2 size={24} className="animate-spin" />
          </div>
        ) : (
          <>
            {/* Hauptbild */}
            <div className="relative group">
              {haupt ? (
                <div className="w-full h-36 rounded-md border border-gray-200 bg-gray-100 flex items-center justify-center overflow-hidden">
                  <img
                    src={kontaktBildUrl(haupt.id)}
                    alt={haupt.dateiname || 'Kontaktbild'}
                    className="max-w-full max-h-full object-contain cursor-zoom-in"
                    onClick={() => setLightbox(haupt)}
                  />
                </div>
              ) : (
                <div className="w-full h-36 rounded-md border border-dashed border-gray-300 bg-gray-50 flex flex-col items-center justify-center text-gray-400">
                  <ImageOff size={28} />
                  <span className="text-xs mt-1">Kein Bild hinterlegt</span>
                </div>
              )}
              {haupt && (
                <button
                  onClick={() => handleDelete(haupt.id)}
                  className="absolute top-1.5 right-1.5 p-1 rounded-md bg-white/90 border border-gray-200 text-red-600 opacity-0 group-hover:opacity-100 transition-opacity hover:bg-red-50"
                  title="Bild loeschen"
                >
                  <Trash2 size={14} />
                </button>
              )}
            </div>

            {/* Weitere Bilder */}
            {weitere.length > 0 && (
              <div className="grid grid-cols-4 gap-1.5 mt-2">
                {weitere.map((b) => (
                  <div key={b.id} className="relative group">
                    <div className="w-full h-14 rounded border border-gray-200 bg-gray-100 flex items-center justify-center overflow-hidden">
                      <img
                        src={kontaktBildUrl(b.id)}
                        alt={b.dateiname || ''}
                        className="max-w-full max-h-full object-contain cursor-zoom-in"
                        onClick={() => setLightbox(b)}
                      />
                    </div>
                    <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity rounded flex items-center justify-center gap-1">
                      <button
                        onClick={(e) => { e.stopPropagation(); handleSetMain(b.id); }}
                        className="p-1 rounded bg-white/90 text-amber-600 hover:bg-amber-50"
                        title="Als Hauptbild"
                      >
                        <Star size={12} />
                      </button>
                      <button
                        onClick={(e) => { e.stopPropagation(); handleDelete(b.id); }}
                        className="p-1 rounded bg-white/90 text-red-600 hover:bg-red-50"
                        title="Loeschen"
                      >
                        <Trash2 size={12} />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Upload-Button */}
            <div className="mt-1.5">
              <input
                ref={fileRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => handleFile(e.target.files && e.target.files[0])}
              />
              <button
                onClick={() => fileRef.current && fileRef.current.click()}
                disabled={uploading}
                className="w-full flex items-center justify-center gap-1.5 px-2 py-1 text-[11px] border border-gray-300 rounded hover:bg-gray-50 disabled:opacity-50"
              >
                {uploading ? <Loader2 size={12} className="animate-spin" /> : <Upload size={12} />}
                {uploading ? 'Laedt hoch...' : 'Hochladen'}
              </button>
            </div>

            {error && (
              <div className="mt-2 text-xs text-red-600 bg-red-50 px-2 py-1 rounded">{error}</div>
            )}
          </>
        )}
      </div>

      {/* Lightbox */}
      {lightbox && (
        <div
          className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-8"
          onClick={() => setLightbox(null)}
        >
          <button
            onClick={() => setLightbox(null)}
            className="absolute top-4 right-4 p-2 bg-white/10 hover:bg-white/20 rounded-full text-white"
          >
            <X size={24} />
          </button>
          <img
            src={kontaktBildUrl(lightbox.id)}
            alt={lightbox.dateiname || ''}
            className="max-w-full max-h-full object-contain"
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      )}
    </div>
  );
}
