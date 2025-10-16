import { UploadDropzone } from "@/components/upload-dropzone";

export default function LandingPage() {
  return (
    <div className="flex min-h-[calc(100vh-8rem)] flex-col justify-center pb-16">
      <UploadDropzone />
    </div>
  );
}
