import SwiftUI
import PhotosUI

/// 用户头像选择页：展示当前头像、选图入口、删除按钮。
/// 选图后进入全屏裁剪界面。
struct UserAvatarPickerView: View {
    @EnvironmentObject private var avatarStore: UserAvatarStore

    @State private var selectedItem: PhotosPickerItem?
    @State private var imageTooCrop: UIImage?
    @State private var showCropView = false

    var body: some View {
        List {
            Section {
                HStack {
                    Spacer()
                    currentAvatarView
                        .frame(width: 100, height: 100)
                        .clipShape(Circle())
                        .overlay(Circle().strokeBorder(.quaternary, lineWidth: 1))
                    Spacer()
                }
                .listRowBackground(Color.clear)
                .padding(.vertical, 8)
            }

            Section {
                PhotosPicker(
                    selection: $selectedItem,
                    matching: .images,
                    photoLibrary: .shared()
                ) {
                    Label("avatar.picker.selectPhoto", systemImage: "photo.on.rectangle")
                }

                if avatarStore.avatar != nil {
                    Button(role: .destructive) {
                        avatarStore.remove()
                    } label: {
                        Label("avatar.picker.remove", systemImage: "trash")
                    }
                }
            } footer: {
                Text("avatar.picker.footer")
            }
        }
        .navigationTitle("avatar.picker.title")
        .navigationBarTitleDisplayMode(.inline)
        .onChange(of: selectedItem) { _, newItem in
            guard let newItem else { return }
            Task {
                if let data = try? await newItem.loadTransferable(type: Data.self),
                   let uiImage = UIImage(data: data) {
                    imageTooCrop = uiImage
                    showCropView = true
                }
                selectedItem = nil
            }
        }
        .fullScreenCover(isPresented: $showCropView) {
            if let image = imageTooCrop {
                AvatarCropView(
                    inputImage: image,
                    onConfirm: { cropped in
                        avatarStore.save(cropped)
                        showCropView = false
                    },
                    onCancel: {
                        showCropView = false
                    }
                )
            }
        }
    }

    @ViewBuilder
    private var currentAvatarView: some View {
        if let avatar = avatarStore.avatar {
            Image(uiImage: avatar)
                .resizable()
                .scaledToFill()
        } else {
            Image(systemName: "person.circle.fill")
                .resizable()
                .scaledToFit()
                .foregroundStyle(.secondary)
        }
    }
}
