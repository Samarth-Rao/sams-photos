import type { Metadata } from "next";
import { notFound } from "next/navigation";
import {
  formatDate,
  getNeighbours,
  getPhoto,
  getPhotos,
  getStreak,
} from "@/lib/photos";
import { PhotoNav } from "@/components/PhotoNav";
import { PolaroidFrame } from "@/components/PolaroidFrame";
import { SiteHeader } from "@/components/SiteHeader";

type Params = { id: string };

export async function generateStaticParams() {
  const photos = await getPhotos();
  return photos.map((photo) => ({ id: photo.id }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<Params>;
}): Promise<Metadata> {
  const { id } = await params;
  const photo = await getPhoto(id);
  if (!photo) return {};

  const dateLabel = formatDate(photo.date);
  const description = photo.caption ?? `Shot ${dateLabel}.`;

  return {
    title: dateLabel,
    description,
    openGraph: {
      title: `${dateLabel} — sam's polaroids`,
      description,
      images: [
        {
          url: photo.full,
          width: photo.width,
          height: photo.height,
          alt: photo.alt ?? photo.caption ?? dateLabel,
        },
      ],
    },
  };
}

export default async function PhotoPage({
  params,
}: {
  params: Promise<Params>;
}) {
  const { id } = await params;
  const photo = await getPhoto(id);
  if (!photo) notFound();

  const [{ previous, next }, streak] = await Promise.all([
    getNeighbours(id),
    getStreak(),
  ]);

  const dateLabel = formatDate(photo.date);

  return (
    <>
      <SiteHeader streak={streak} />
      <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-10 sm:px-6 lg:px-8">
        <h1 className="sr-only">Photo from {dateLabel}</h1>

        <PolaroidFrame photo={photo} dateLabel={dateLabel} priority />

        <div className="mx-auto mt-6 w-full" style={{ maxWidth: 620 }}>
          <PhotoNav previous={previous} next={next} />
        </div>
      </main>
    </>
  );
}
