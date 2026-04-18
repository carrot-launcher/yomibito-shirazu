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
  blockedHandles?: Record<string, { blockedAt: Timestamp; sampleBody?: string; targetUid?: string }>;
  blockedByHandles?: Record<string, { blockedAt: Timestamp }>;
}

export interface GroupDoc {
  name: string;
  inviteCode: string;
  memberCount: number;
  createdBy: string;
  bannedUsers?: Record<string, { displayName: string; userCode: string }>;
  createdAt: Timestamp;
  lastPostAt?: Timestamp;
  // 投稿者ハンドルごとの最終投稿時刻。未読判定でブロック関係の相手を除外して
  // 「自分にとっての実効的な最新投稿時刻」を求めるために使う。
  lastPostsByHandle?: Record<string, Timestamp>;
  // 公開歌会（作成時に固定、変更不可）
  isPublic?: boolean;
  purpose?: string;       // 趣意書（公開歌会のみ、25〜200字）
  postCount?: number;     // 累計投稿数（発見画面のソート・表示用）
  // オーナー情報の非正規化キャッシュ（発見画面などで再取得を避けるため）
  ownerDisplayName?: string;
  ownerUserCode?: string;
}

export interface MemberDoc {
  displayName: string;
  userCode: string;
  joinedAt: Timestamp;
  role: 'owner' | 'member';
  cautionCount?: number;
  lastReadAt?: Timestamp;
  muted?: boolean;
}

export interface PostDoc {
  groupId: string;
  body: string;
  batchId: string;
  convertHalfSpace?: boolean;
  convertLineBreak?: boolean;
  createdAt: Timestamp;
  reactionSummary: Record<string, number>;
  commentCount: number;
  authorHandle?: string;  // HMAC-SHA256(salt, uid).slice(0,12) — ブロック機能のため
  reportCount?: number;   // ユニーク reporter 数
  hogo?: boolean;
  hogoReason?: string;
  hogoType?: 'caution' | 'ban' | 'pending';
  revealedAuthorName?: string;
  revealedAuthorCode?: string;
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
  authorHandle?: string;  // HMAC-SHA256(salt, uid).slice(0,12) — ブロック機能のため
  reportCount?: number;   // ユニーク reporter 数
  hogo?: boolean;
  hogoReason?: string;
  hogoType?: 'caution' | 'ban' | 'pending';
}

export type ReportReason = 'inappropriate' | 'spam' | 'harassment' | 'other';

export interface ReportDoc {
  targetType: 'post' | 'comment';
  targetId: string;       // postId または commentId
  postId: string;         // 親 postId（コメントでも保持）
  groupId: string;
  reporterId: string;
  reason: ReportReason;
  detail?: string;        // reason='other' の場合のみ、500字まで
  createdAt: Timestamp;
  status: 'pending' | 'resolved';
}

export interface MyPostDoc {
  postId: string;
  groupId: string;
  groupName: string;
  tankaBody: string;
  batchId: string;
  convertHalfSpace?: boolean;
  convertLineBreak?: boolean;
  createdAt: Timestamp;
}

export interface BookmarkDoc {
  groupId: string;
  groupName: string;
  tankaBody: string;
  createdAt: Timestamp;
}

export interface NotificationDoc {
  type: 'new_post' | 'reaction' | 'comment' | 'caution' | 'ban' | 'dissolve' | 'report';
  postId?: string;
  commentId?: string;
  groupId?: string;
  groupName: string;
  tankaBody?: string;
  emoji?: string;
  commentBody?: string;
  reactionCount?: number;
  cautionCount?: number;
  bannedUserName?: string;
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
  convertHalfSpace?: boolean;
  convertLineBreak?: boolean;
  hogo?: boolean;
  hogoReason?: string;
  hogoType?: 'caution' | 'ban' | 'pending';
  authorHandle?: string;
  revealedAuthorName?: string;
  revealedAuthorCode?: string;
}
