import type { Metadata } from "next";
import { LegalPage, contact } from "@/components/legal";

export const metadata: Metadata = { title: "Terms of Service · InvestHepi" };

export default function Terms() {
  return (
    <LegalPage title="Terms of Service">
      <p>By using InvestHepi you agree to these terms. If you don&apos;t, please don&apos;t use the app.</p>

      <h2>Not financial advice</h2>
      <p>
        InvestHepi summarizes public news with AI and shows predictions, confidence levels and suggested actions. These are automated, can be wrong,
        and are for information only. They are not investment, tax or legal advice, and are not a recommendation to buy or sell anything. Prices may be
        delayed or inaccurate. You are responsible for your own decisions; check the track record and do your own research.
      </p>

      <h2>Your account</h2>
      <p>
        Sign in with a Google account you control and don&apos;t use the app to break the law, overload it, scrape it, or get around its limits. We
        may limit or close accounts that do, and may change or stop the free service at any time.
      </p>

      <h2>Content</h2>
      <p>Headlines and links belong to their publishers. Market data comes from third-party sources and may be incomplete.</p>

      <h2>No warranty</h2>
      <p>
        The app is provided &quot;as is&quot;, without warranties of any kind. To the extent the law allows, InvestHepi is not liable for any loss,
        including trading losses, that comes from using it.
      </p>

      <h2>Privacy</h2>
      <p>
        See the <a href="/privacy">Privacy Policy</a>.
      </p>

      <h2>Contact</h2>
      <p>{contact()}</p>

      <hr />
      <h2 lang="vi">Tóm tắt bằng tiếng Việt</h2>
      <p lang="vi">
        Dự đoán và gợi ý hành động trên InvestHepi do AI tạo tự động từ tin tức công khai, có thể sai và chỉ mang tính tham khảo. Đây không phải lời
        khuyên đầu tư. Bạn tự chịu trách nhiệm với quyết định của mình. Ứng dụng được cung cấp &quot;nguyên trạng&quot;, không có bảo đảm.
      </p>
    </LegalPage>
  );
}
