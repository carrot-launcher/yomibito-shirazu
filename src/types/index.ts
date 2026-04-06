import { Timestamp } from 'firebase/firestore';

// ===== Firestore ドキュメント型 =====

export interface UserDoc {
  userCode: string;               // 固有ID（6桁数字）
  fcmToken: string;
  joinedGroups: string[];
  notificationSettings: {
    newPost: boolean;
    reaction: boolean;
    comment: boolean;
  };
  createdAt: Timestamp;
}

export interface GroupDoc {
  name: string;
  inviteCode: string;
  memberCount: number;
  createdBy: string;
  bannedUsers?: Record<string, { displayName: string; userCode: string }>;
  createdAt: Timestamp;
}

export interface MemberDoc {
  displayName: string;
  userCode: string;
  joinedAt: Timestamp;
  role: 'owner' | 'member';
}

export interface PostDoc {
  groupId: string;
  body: string;
  batchId: string;
  createdAt: Timestamp;
  reactionSummary: Record<string, number>;
  commentCount: number;
}

export interface ReactionDoc {
  emoji: string;
  userId: string;
  displayName: string;
  createdAt: Timestamp;
}

export interface CommentDoc {
  body: string;
  createdAt: Timestamp;
}

export interface MyPostDoc {
  postId: string;
  groupId: string;
  groupName: string;
  tankaBody: string;
  batchId: string;
  createdAt: Timestamp;
}

export interface BookmarkDoc {
  groupId: string;
  groupName: string;
  tankaBody: string;
  createdAt: Timestamp;
}

export interface NotificationDoc {
  type: 'new_post' | 'reaction' | 'comment';
  postId: string;
  groupId: string;
  groupName: string;
  tankaBody: string;
  emoji?: string;
  commentBody?: string;
  reactionCount?: number;
  createdAt: Timestamp;
}

// ===== UI用型 =====

export const REACTION_EMOJI = '🌸' as const;

export interface TankaCard {
  postId: string;
  groupId: string;
  body: string;
  createdAt: Date;
  reactionSummary: Record<string, number>;
  commentCount: number;
  groupName?: string;
  batchId?: string;
  bookmarkedAt?: Date;
}
