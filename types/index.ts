export type Profile = {
  id: string;
  role: 'admin' | 'student'; // 先生 or 生徒・保護者
  student_name: string | null;
  parent_name: string | null;
  grade: string | null;
  avatar_url: string | null;
};

export type Assignment = {
  id: number;
  title: string;
  subject: string; // '理科' | '社会' など
  deadline: string; // 日付文字列
  description: string | null;
};

// 投稿時のモード（誰として操作するか）
export type UserMode = 'student' | 'guardian';