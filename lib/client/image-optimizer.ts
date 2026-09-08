/**
 * 모바일 현장 고화질(10~20MB) 영수증 사진을 전송 전 1~2MB 내외로 압축 및 회전 최적화
 */
export async function optimizeReceiptImage(
  file: File,
  maxDimension = 2400,
  quality = 0.85,
): Promise<File> {
  if (typeof window === 'undefined' || !file.type.startsWith('image/') || file.type.includes('svg')) {
    return file;
  }

  // 1.5MB 미만의 작은 이미지는 원본 유지
  if (file.size < 1.5 * 1024 * 1024) {
    return file;
  }

  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = document.createElement('img');
      img.onload = () => {
        let width = img.naturalWidth || img.width;
        let height = img.naturalHeight || img.height;

        if (width > maxDimension || height > maxDimension) {
          if (width > height) {
            height = Math.round((height * maxDimension) / width);
            width = maxDimension;
          } else {
            width = Math.round((width * maxDimension) / height);
            height = maxDimension;
          }
        }

        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          resolve(file);
          return;
        }

        ctx.drawImage(img, 0, 0, width, height);
        canvas.toBlob(
          (blob) => {
            if (!blob || blob.size >= file.size) {
              resolve(file);
              return;
            }
            const optimizedFile = new File([blob], file.name.replace(/\.[^.]+$/, '.jpg'), {
              type: 'image/jpeg',
              lastModified: Date.now(),
            });
            resolve(optimizedFile);
          },
          'image/jpeg',
          quality,
        );
      };
      img.onerror = () => resolve(file);
      img.src = e.target?.result as string;
    };
    reader.onerror = () => resolve(file);
    reader.readAsDataURL(file);
  });
}

/**
 * 모바일 환경에서 Blob URL 해제 버그를 방지하는 안정적인 Base64 데이터 URL 생성기
 */
export function generatePreviewDataUrl(file: File): Promise<string> {
  return new Promise((resolve) => {
    if (typeof window === 'undefined') {
      resolve('');
      return;
    }
    const reader = new FileReader();
    reader.onload = (e) => {
      resolve(typeof e.target?.result === 'string' ? e.target.result : '');
    };
    reader.onerror = () => {
      try {
        resolve(URL.createObjectURL(file));
      } catch {
        resolve('');
      }
    };
    reader.readAsDataURL(file);
  });
}

