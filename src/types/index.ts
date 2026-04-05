import { Timestamp } from 'firebase/firestore';

// ===== Firestore ドキュメント型 =====

export interface UserDoc {
  defaultDisplayName: string;
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
  createdAt: Timestamp;
}

export interface MemberDoc {
  displayName: string;
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
  read: boolean;
  createdAt: Timestamp;
}

// ===== UI用型 =====

export const REACTION_EMOJIS = ['🌸', '😢', '💫', '😊', '🤔'] as const;
export type ReactionEmoji = typeof REACTION_EMOJIS[number];

export const REACTION_LABELS: Record<ReactionEmoji, string> = {
  '🌸': '美しい',
  '😢': '切ない',
  '💫': 'すごい',
  '😊': 'あたたかい',
  '🤔': '深い',
};

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
