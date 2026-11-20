/**
 * Prompt template có số phiên bản. Đổi nội dung prompt → tăng `version` để cache cũ không còn dùng.
 * Mỗi template: system instruction + JSON schema (structured output) + hàm dựng nội dung.
 */

export interface PromptTemplate {
  kind: string
  version: number
  schema: Record<string, unknown>
  /** Chỉ dẫn riêng của loại giải thích này (nối sau quy tắc chung). */
  task: string
}

/** Quy tắc chung chống "bịa": Stockfish tính, Gemini chỉ diễn giải. */
export function systemInstruction(name: string, task: string): string {
  return `Bạn là huấn luyện viên cờ vua, giải thích cho học trò tên "${name}" (xưng hô: gọi là "bạn").

QUY TẮC BẮT BUỘC:
1. Mọi đánh giá và tính toán đã được Stockfish thực hiện và nằm trong phần DỮ LIỆU. Bạn chỉ DIỄN GIẢI, không tự tính.
2. CHỈ nhắc tới các nước đi có trong DỮ LIỆU (nước đã đi, nước tốt nhất, các biến của engine). Tuyệt đối không tự nghĩ ra nước hay biến mới. Viết nước đi bằng ký hiệu SAN đúng như trong dữ liệu.
3. Giải thích TẠI SAO (ý tưởng, mối đe dọa, kế hoạch, cấu trúc), không chỉ lặp lại điểm số.
4. Dùng các motif chiến thuật đã được phát hiện trong dữ liệu làm căn cứ; không khẳng định motif không có trong dữ liệu.
5. Viết tiếng Việt tự nhiên, ngắn gọn, dễ hiểu; giữ thuật ngữ cờ phổ biến kèm tiếng Anh trong ngoặc, ví dụ "nĩa (fork)", "ghim (pin)", "tốt thông (passed pawn)".
6. Nói theo góc nhìn của ${name}: "bạn đã bỏ lỡ...", "đối thủ đang đe dọa...". Nếu dữ liệu nói đây không phải ván của ${name} thì nói theo góc nhìn trung lập.
7. Chỉ trả về JSON đúng schema, không thêm chữ nào ngoài JSON.

NHIỆM VỤ:
${task}`
}

const str = { type: 'string' }
const strArr = { type: 'array', items: { type: 'string' } }

const moveProps = {
  tom_tat: { ...str, description: '1 câu ngắn gọn tóm tắt nước đi' },
  vi_sao_nuoc_di_kem: { ...str, description: 'Vì sao nước đã đi kém (để trống nếu nước đi tốt)' },
  vi_sao_nuoc_tot_nhat_tot_hon: { ...str, description: 'Nước tốt nhất là gì và vì sao tốt hơn (hoặc vì sao nước đã đi là tốt)' },
  y_tuong_chien_thuat: { ...strArr, description: 'Các ý tưởng/motif chiến thuật liên quan' },
  ke_hoach_tiep_theo: { ...str, description: 'Kế hoạch hợp lý tiếp theo' },
  bai_hoc: { ...str, description: '1 bài học rút ra để áp dụng ván sau' }
}
const moveRequired = Object.keys(moveProps)

export const MOVE: PromptTemplate = {
  kind: 'move',
  version: 1,
  schema: { type: 'object', properties: moveProps, required: moveRequired },
  task: 'Giải thích một nước đi trong ván: vì sao nó tốt hoặc kém, nước tốt nhất là gì và vì sao.'
}

export const MOMENTS: PromptTemplate = {
  kind: 'moments',
  version: 1,
  schema: {
    type: 'object',
    properties: {
      giai_thich: {
        type: 'array',
        items: { type: 'object', properties: { ply: { type: 'integer' }, ...moveProps }, required: ['ply', ...moveRequired] }
      }
    },
    required: ['giai_thich']
  },
  task: 'Giải thích LẦN LƯỢT từng khoảnh khắc quan trọng trong danh sách (mỗi khoảnh khắc một phần tử, giữ đúng số "ply"). Mỗi khoảnh khắc độc lập, chỉ dùng dữ liệu của chính nó.'
}

export const GAME: PromptTemplate = {
  kind: 'game',
  version: 1,
  schema: {
    type: 'object',
    properties: {
      tom_tat: { ...str, description: '2-3 câu tóm tắt cả ván' },
      dien_bien: { ...str, description: 'Diễn biến chính theo các giai đoạn' },
      buoc_ngoat: {
        type: 'array',
        items: { type: 'object', properties: { ply: { type: 'integer' }, mo_ta: str }, required: ['ply', 'mo_ta'] }
      },
      bai_hoc: { ...strArr, description: 'Đúng 3 bài học' }
    },
    required: ['tom_tat', 'dien_bien', 'buoc_ngoat', 'bai_hoc']
  },
  task: 'Tóm tắt cả ván: diễn biến chính, các bước ngoặt (dựa trên các khoảnh khắc quan trọng đã cung cấp) và đúng 3 bài học.'
}

export const OPENING: PromptTemplate = {
  kind: 'opening',
  version: 1,
  schema: {
    type: 'object',
    properties: {
      y_tuong_chinh: str,
      ke_hoach_trang: str,
      ke_hoach_den: str,
      cam_bay: strArr,
      cau_truc_tot: str,
      loi_khuyen: str
    },
    required: ['y_tuong_chinh', 'ke_hoach_trang', 'ke_hoach_den', 'cam_bay', 'cau_truc_tot', 'loi_khuyen']
  },
  task: 'Giải thích khai cuộc/biến thể: ý tưởng chính, kế hoạch điển hình của hai bên, cạm bẫy phổ biến, cấu trúc tốt đặc trưng. Kiến thức chung về khai cuộc được phép, nhưng khi nêu nước cụ thể chỉ dùng nước có trong dữ liệu.'
}

export const OVERVIEW: PromptTemplate = {
  kind: 'overview',
  version: 1,
  schema: {
    type: 'object',
    properties: {
      tong_quan: str,
      diem_yeu: strArr,
      goi_y_luyen_tap: { ...strArr, description: '3-5 gợi ý luyện tập cụ thể' }
    },
    required: ['tong_quan', 'diem_yeu', 'goi_y_luyen_tap']
  },
  task: 'Dựa trên số liệu thống kê nhiều ván, nhận xét tổng quan điểm mạnh/yếu và đưa ra 3–5 gợi ý luyện tập cụ thể, đo lường được.'
}

export const PUZZLE: PromptTemplate = {
  kind: 'puzzle',
  version: 1,
  schema: {
    type: 'object',
    properties: {
      tom_tat: str,
      vi_sao_loi_giai_dung: str,
      vi_sao_nuoc_trong_van_sai: str,
      y_tuong_chien_thuat: strArr,
      bai_hoc: str
    },
    required: ['tom_tat', 'vi_sao_loi_giai_dung', 'vi_sao_nuoc_trong_van_sai', 'y_tuong_chien_thuat', 'bai_hoc']
  },
  task: 'Giải thích lời giải của bài tập (puzzle) tạo từ sai lầm của chính học trò: vì sao lời giải đúng và vì sao nước học trò đã đi trong ván là sai.'
}
