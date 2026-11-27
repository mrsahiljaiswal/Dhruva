import type { DiscussionComment, DiscussionPost, DiscussionThread, ReportView } from "@dhruva/shared";
import type { CommentRecord, PostRecord, ReactionRecord, ReportRecord } from "./repository.js";

function reactionSummary(reactions: ReactionRecord[], targetId: string, viewerId: string) {
  const rows = reactions.filter((reaction) => reaction.targetId === targetId);
  return {
    helpfulCount: rows.filter((reaction) => reaction.kind === "HELPFUL").length,
    likeCount: rows.filter((reaction) => reaction.kind === "LIKE").length,
    viewerHelpful: rows.some((reaction) => reaction.kind === "HELPFUL" && reaction.userId === viewerId),
    viewerLike: rows.some((reaction) => reaction.kind === "LIKE" && reaction.userId === viewerId),
  };
}

export function presentPost(
  post: PostRecord,
  authorName: string,
  reactions: ReactionRecord[],
  viewerId: string,
): DiscussionPost {
  return {
    id: post.id,
    scope: post.scope,
    resourceId: post.resourceId,
    category: post.category,
    authorId: post.authorId,
    authorName,
    title: post.title,
    body: post.body,
    codeSnippet: post.codeSnippet,
    status: post.status,
    acceptedCommentId: post.acceptedCommentId,
    highlighted: post.highlighted,
    replyCount: post.replyCount,
    ...reactionSummary(reactions, post.id, viewerId),
    createdAt: post.createdAt.toISOString(),
    updatedAt: post.updatedAt.toISOString(),
  };
}

export function presentComment(
  comment: CommentRecord,
  authorName: string,
  reactions: ReactionRecord[],
  viewerId: string,
  acceptedCommentId: string | null,
): DiscussionComment {
  return {
    id: comment.id,
    postId: comment.postId,
    parentCommentId: comment.parentCommentId,
    authorId: comment.authorId,
    authorName,
    body: comment.body,
    ...reactionSummary(reactions, comment.id, viewerId),
    accepted: comment.id === acceptedCommentId,
    createdAt: comment.createdAt.toISOString(),
  };
}

export function presentThread(
  post: PostRecord,
  comments: CommentRecord[],
  names: Map<string, string>,
  postReactions: ReactionRecord[],
  commentReactions: ReactionRecord[],
  viewerId: string,
): DiscussionThread {
  return {
    ...presentPost(post, names.get(post.authorId) ?? "Unknown", postReactions, viewerId),
    comments: comments.map((comment) =>
      presentComment(
        comment,
        names.get(comment.authorId) ?? "Unknown",
        commentReactions,
        viewerId,
        post.acceptedCommentId,
      ),
    ),
  };
}

export function presentReport(report: ReportRecord): ReportView {
  return {
    id: report.id,
    targetType: report.targetType,
    targetId: report.targetId,
    reportedBy: report.reportedBy,
    reason: report.reason,
    status: report.status,
    createdAt: report.createdAt.toISOString(),
  };
}
