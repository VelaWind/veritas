import { Skeleton } from "@/components/ui/Skeleton";

// Shared loading UI for dynamic public pages (search, filtered lists, etc.).
export default function Loading() {
  return (
    <div className="mx-auto max-w-content space-y-8 px-4 py-12 sm:px-6">
      <div className="space-y-3 border-b border-edge pb-8">
        <Skeleton className="h-3 w-32" />
        <Skeleton className="h-8 w-2/3" />
        <Skeleton className="h-4 w-1/2" />
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="card space-y-4 p-5">
            <Skeleton className="h-5 w-3/4" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-5/6" />
            <Skeleton className="h-2.5 w-full" />
          </div>
        ))}
      </div>
    </div>
  );
}
