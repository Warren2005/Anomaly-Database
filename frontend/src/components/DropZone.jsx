import React, { useState, useCallback, useRef } from "react";

const ACCEPTED_TYPES = ["image/jpeg", "image/png", "image/tiff"];

export default function DropZone({ onFileDrop }) {
  const [isDragging, setIsDragging] = useState(false);
  const [preview, setPreview] = useState(null);
  const fileInputRef = useRef(null);

  const handleFile = useCallback(
    (file) => {
      if (!file) return;
      if (!ACCEPTED_TYPES.includes(file.type)) {
        alert("Please use a JPEG, PNG, or TIFF image.");
        return;
      }

      // Show preview
      const reader = new FileReader();
      reader.onload = (e) => setPreview(e.target.result);
      reader.readAsDataURL(file);

      // Trigger search
      onFileDrop(file);
    },
    [onFileDrop]
  );

  const handleDragOver = useCallback((e) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e) => {
    e.preventDefault();
    setIsDragging(false);
  }, []);

  const handleDrop = useCallback(
    (e) => {
      e.preventDefault();
      setIsDragging(false);
      const file = e.dataTransfer.files[0];
      handleFile(file);
    },
    [handleFile]
  );

  const handleBrowse = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const handleInputChange = useCallback(
    (e) => {
      const file = e.target.files[0];
      handleFile(file);
    },
    [handleFile]
  );

  return (
    <div
      className={`dropzone ${isDragging ? "dropzone-active" : ""}`}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {preview ? (
        <img src={preview} alt="Query" className="dropzone-preview" />
      ) : (
        <>
          <div className="dropzone-icon">
            <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M17 8l-5-5-5 5M12 3v12" />
            </svg>
          </div>
          <p className="dropzone-text">
            Drag and drop an anomaly image here
          </p>
          <p className="dropzone-subtext">or</p>
          <button className="btn btn-primary" onClick={handleBrowse}>
            Browse Files
          </button>
          <p className="dropzone-formats">JPEG, PNG, or TIFF</p>
        </>
      )}
      <input
        ref={fileInputRef}
        type="file"
        accept=".jpg,.jpeg,.png,.tiff,.tif"
        style={{ display: "none" }}
        onChange={handleInputChange}
      />
    </div>
  );
}
