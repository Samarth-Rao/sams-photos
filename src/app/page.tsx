import { computeStreak, formatDateShort, getPhotos, isConfigured } from "@/lib/photos";
import { EmptyState } from "@/components/EmptyState";
import { PhotoGrid } from "@/components/PhotoGrid";
import { PolaroidFrame } from "@/components/PolaroidFrame";
import { SiteHeader } from "@/components/SiteHeader";
import { StreakPacks } from "@/components/StreakPacks";

export default async function Home() {
  if (!isConfigured) {
    return <EmptyState variant="unconfigured" />;
  }

  const photos = await getPhotos();

  if (photos.length === 0) {
    return <EmptyState variant="no-photos" />;
  }

  const streak = computeStreak(photos);
  const latest = photos[0];
  const dateLabel = formatDateShort(latest.date);

  return (
    <>
      <SiteHeader streak={streak} />
      <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-10 sm:px-6 lg:px-8">
        <h1 className="sr-only">
          sam&apos;s polaroids — a daily photography practice
        </h1>

        <PolaroidFrame photo={latest} dateLabel={dateLabel} develop priority />

        <div className="mt-8">
          <StreakPacks streak={streak} />
        </div>

        <section className="mt-16">
          <div className="flex items-baseline justify-between gap-4 border-b border-hairline pb-3">
            <h2 className="display-expanded text-xl sm:text-2xl">the archive</h2>
            <p className="label-mono">{photos.length} photos</p>
          </div>
          <div className="mt-4">
            <PhotoGrid photos={photos} />
          </div>
        </section>
      </main>
    </>
  );
}
