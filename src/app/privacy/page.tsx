import type { Metadata } from "next";
import { LegalPage, contact } from "@/components/legal";

export const metadata: Metadata = { title: "Privacy Policy · InvestHepi" };

export default function Privacy() {
  return (
    <LegalPage title="Privacy Policy">
      <p>
        InvestHepi is a free market-news app that summarizes public headlines with AI. This page explains what we store, why, and how to have it
        deleted. We don&apos;t sell your data, show ads, or use it for anything other than running the app.
      </p>

      <h2>What we collect</h2>
      <ul>
        <li>
          <b>Google sign-in:</b> your email address and name (and your profile picture, which is only kept in your browser&apos;s sign-in cookie). We
          use them to identify your account. We never see your Google password and request no other Google data.
        </li>
        <li>
          <b>What you enter:</b> the interests and tickers you follow, your settings (language, alert preferences), holdings you choose to add
          (shares and cost), an email address for price alerts, and questions you send to Ask AI.
        </li>
        <li>
          <b>Basic usage:</b> when you last visited (used to decide which briefings to keep up to date), and anonymous page-view statistics from Vercel
          Web Analytics, which uses no cookies and doesn&apos;t identify you.
        </li>
        <li>
          <b>In your browser only:</b> theme, language, which headlines you&apos;ve read and saved. These stay on your device.
        </li>
      </ul>

      <h2>Who processes it</h2>
      <ul>
        <li><b>Vercel</b> hosts the app. <b>Upstash</b> stores account data (interests, settings, holdings, alert settings).</li>
        <li>
          <b>AI providers</b> (Groq, Google Gemini, and Anthropic when enabled) receive public headlines, market data, and your followed tickers to write
          briefings. For Ask AI they also receive your question and, if you added holdings, position weights and gain percentages. Share counts and
          money amounts are never sent.
        </li>
        <li><b>Email providers</b> (Resend or an SMTP service) receive your alert email address and the alert text, only if you turn alerts on.</li>
        <li><b>Google</b> handles sign-in.</li>
      </ul>

      <h2>Cookies</h2>
      <p>One sign-in cookie keeps you logged in for up to 90 days. It is removed when you sign out. There are no advertising or tracking cookies.</p>

      <h2>Keeping and deleting data</h2>
      <p>
        Your data is kept while your account is in use. To delete your account and everything stored for it, email {contact()} from the address you
        signed in with, and it will be deleted within 30 days. You can also remove your holdings and alert email yourself at any time in Settings.
        Briefings are shared between people who follow the same interests and contain no personal data.
      </p>

      <h2>Children</h2>
      <p>InvestHepi is not meant for anyone under 18.</p>

      <h2>Changes and contact</h2>
      <p>If this policy changes, the date above changes with it. Questions: {contact()}.</p>

      <hr />
      <h2 lang="vi">Tóm tắt bằng tiếng Việt</h2>
      <p lang="vi">
        InvestHepi chỉ lưu email và tên từ tài khoản Google của bạn, cùng những gì bạn nhập (danh mục theo dõi, cài đặt, danh mục đầu tư nếu có, email
        nhận cảnh báo, câu hỏi gửi AI). Dữ liệu được lưu trên Vercel và Upstash. Tin tức công khai, mã cổ phiếu bạn theo dõi và tỷ trọng danh mục (không
        bao giờ là số tiền hay số lượng cổ phiếu) được gửi tới nhà cung cấp AI để tạo bản tin. Chúng tôi không bán dữ liệu và không chạy quảng cáo. Muốn
        xóa tài khoản, hãy gửi email tới {contact()} từ địa chỉ bạn dùng để đăng nhập; dữ liệu sẽ được xóa trong vòng 30 ngày.
      </p>
    </LegalPage>
  );
}
