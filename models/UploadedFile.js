import mongoose from 'mongoose';

const uploadedFileSchema = new mongoose.Schema(
  {
    filename: { type: String, required: true, unique: true, index: true },
    folder: {
      type: String,
      required: true,
      enum: ['images', 'documents', 'resumes'],
      index: true,
    },
    originalname: { type: String, trim: true },
    mimetype: { type: String, required: true },
    size: { type: Number },
    data: { type: Buffer, required: true },
  },
  { timestamps: true }
);

export const UploadedFile =
  mongoose.models.UploadedFile || mongoose.model('UploadedFile', uploadedFileSchema);
