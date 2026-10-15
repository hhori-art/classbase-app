export type AttendanceStatus = "active" | "deleted";

export type AttendanceWorkSegment = {
  start: string;
  end: string;
  type: "lesson" | "office" | "support" | "break";
  note: string;
  minutes: number | null;
  course_code: string | null;
  course_name: string | null;
  work_code: string | null;
  work_name: string | null;
  school_code: string | null;
  school_name: string | null;
};

export type ActiveAttendanceRecord = {
  source_record_id: string;
  person_code: string;
  person_name: string;
  date: string;
  start_time: string | null;
  end_time: string | null;
  work_type: string;
  work_segments: AttendanceWorkSegment[];
  status: "active";
  updated_at: string;
};

export type DeletedAttendanceRecord = {
  source_record_id: string;
  status: "deleted";
  updated_at: string;
};

export type AttendanceRecord = ActiveAttendanceRecord | DeletedAttendanceRecord;

export type ImportError = { index: number; code: string; field?: string };
export type ImportResult = {
  ok: true;
  received_count: number;
  stored_count: number;
  deleted_count: number;
  invalid_count: number;
  errors: ImportError[];
};

export type ImportEnvelope = {
  batch_id: string;
  source: string;
  sent_at: string;
  records: unknown[];
};
