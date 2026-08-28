import { PostDetail } from "@/components/post-detail";

export default async function PostDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <PostDetail postId={id} />;
}