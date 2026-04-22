import SwiftUI

struct ThankYouView: View {
    let onDismiss: () -> Void

    @State private var heartScale: CGFloat = 0.3
    @State private var heartOpacity: Double = 0
    @State private var textOpacity: Double = 0
    @State private var buttonOpacity: Double = 0
    @State private var particles: [Particle] = []

    var body: some View {
        ZStack {
            // 背景渐变
            LinearGradient(
                colors: [
                    Color(red: 0.98, green: 0.92, blue: 0.95),
                    Color(red: 0.94, green: 0.88, blue: 0.98),
                ],
                startPoint: .topLeading,
                endPoint: .bottomTrailing
            )
            .ignoresSafeArea()

            // 粒子
            ForEach(particles) { p in
                Text(p.emoji)
                    .font(.system(size: p.size))
                    .position(p.position)
                    .opacity(p.opacity)
            }

            VStack(spacing: 0) {
                Spacer()

                // 爱心图标
                ZStack {
                    Circle()
                        .fill(
                            LinearGradient(
                                colors: [Color.pink.opacity(0.2), Color.purple.opacity(0.15)],
                                startPoint: .topLeading,
                                endPoint: .bottomTrailing
                            )
                        )
                        .frame(width: 120, height: 120)

                    Image(systemName: "heart.fill")
                        .font(.system(size: 52))
                        .foregroundStyle(
                            LinearGradient(
                                colors: [.pink, Color(red: 0.8, green: 0.3, blue: 0.9)],
                                startPoint: .topLeading,
                                endPoint: .bottomTrailing
                            )
                        )
                        .symbolEffect(.bounce, value: heartScale)
                }
                .scaleEffect(heartScale)
                .opacity(heartOpacity)
                .padding(.bottom, 32)

                // 文字
                VStack(spacing: 12) {
                    Text(NSLocalizedString("tip.thanks.title", comment: ""))
                        .font(.system(size: 28, weight: .bold, design: .rounded))
                        .foregroundStyle(Color(red: 0.3, green: 0.1, blue: 0.4))

                    Text(NSLocalizedString("tip.thanks.message", comment: ""))
                        .font(.system(size: 16, weight: .regular, design: .rounded))
                        .foregroundStyle(Color(red: 0.5, green: 0.3, blue: 0.6))
                        .multilineTextAlignment(.center)
                        .padding(.horizontal, 40)
                        .lineSpacing(4)
                }
                .opacity(textOpacity)
                .padding(.bottom, 48)

                Spacer()

                // 关闭按钮
                Button(action: onDismiss) {
                    Text(NSLocalizedString("tip.thanks.close", comment: ""))
                        .font(.system(size: 17, weight: .semibold, design: .rounded))
                        .foregroundStyle(.white)
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 16)
                        .background(
                            LinearGradient(
                                colors: [.pink, Color(red: 0.7, green: 0.2, blue: 0.9)],
                                startPoint: .leading,
                                endPoint: .trailing
                            ),
                            in: RoundedRectangle(cornerRadius: 16, style: .continuous)
                        )
                }
                .padding(.horizontal, 32)
                .padding(.bottom, 48)
                .opacity(buttonOpacity)
            }
        }
        .onAppear { runEntrance() }
    }

    private func runEntrance() {
        withAnimation(.spring(response: 0.55, dampingFraction: 0.6).delay(0.1)) {
            heartScale = 1.0
            heartOpacity = 1.0
        }
        withAnimation(.easeOut(duration: 0.5).delay(0.4)) {
            textOpacity = 1.0
        }
        withAnimation(.easeOut(duration: 0.4).delay(0.7)) {
            buttonOpacity = 1.0
        }
        spawnParticles()
    }

    private func spawnParticles() {
        let emojis = ["✨", "💖", "🎉", "⭐️", "💫", "🌟"]
        let bounds = UIApplication.shared.connectedScenes
            .compactMap { $0 as? UIWindowScene }
            .first?.screen.bounds ?? CGRect(x: 0, y: 0, width: 390, height: 844)
        let width = bounds.width
        let height = bounds.height

        for i in 0..<18 {
            let delay = Double(i) * 0.08
            var p = Particle(
                emoji: emojis[i % emojis.count],
                size: CGFloat.random(in: 14...26),
                position: CGPoint(
                    x: CGFloat.random(in: 20...(width - 20)),
                    y: CGFloat.random(in: 80...(height * 0.65))
                ),
                opacity: 0
            )
            particles.append(p)
            let idx = particles.count - 1
            withAnimation(.easeIn(duration: 0.3).delay(delay)) {
                particles[idx].opacity = Double.random(in: 0.5...0.9)
            }
            withAnimation(.easeOut(duration: 0.6).delay(delay + 0.8)) {
                particles[idx].opacity = 0
            }
        }
    }
}

private struct Particle: Identifiable {
    let id = UUID()
    let emoji: String
    let size: CGFloat
    let position: CGPoint
    var opacity: Double
}

// MARK: - Preview

#Preview {
    ThankYouView { }
}
