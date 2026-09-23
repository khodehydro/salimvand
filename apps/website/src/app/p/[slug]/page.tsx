import { redirect } from 'next/navigation';

export default async function ShortProductLink({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  redirect(`/product/${encodeURIComponent(decodeURIComponent(slug))}`);
}
