import { HomepageApp } from "@/components/homepage-app";
import { UploadDropzone } from "@/components/upload-dropzone";

export default function LandingPage() {
  return (
    <div className="space-y-16 pb-16">
      <section className="flex min-h-[calc(100vh-8rem)] flex-col justify-center">
        <UploadDropzone />
      </section>
      <HomepageApp />
    </div>
  );
}
