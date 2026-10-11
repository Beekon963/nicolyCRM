import { ListSkeleton } from "@/components/app/page-skeleton";

export default function Loading() {
  return <ListSkeleton rows={10} filters={false} />;
}
