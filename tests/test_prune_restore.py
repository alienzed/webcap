import os
import shutil
import requests
from pathlib import Path

BASE_URL = "http://127.0.0.1:5000"
FS_ROOT = r"C:/Users/mschmid/Documents/repos/training"
TEST_FOLDER = os.path.join(FS_ROOT, "test_prune_restore")
ORIGINALS = os.path.join(TEST_FOLDER, "originals")
MEDIA1 = "test1.mp4"
MEDIA2 = "test2.mp4"
CAPTION1 = "test1.txt"
CAPTION2 = "test2.txt"

# Setup test folder
os.makedirs(TEST_FOLDER, exist_ok=True)
with open(os.path.join(TEST_FOLDER, MEDIA1), "wb") as f:
    f.write(b"media1-data")
with open(os.path.join(TEST_FOLDER, MEDIA2), "wb") as f:
    f.write(b"media2-data")
with open(os.path.join(TEST_FOLDER, CAPTION1), "w", encoding="utf-8") as f:
    f.write("caption1-data")
with open(os.path.join(TEST_FOLDER, CAPTION2), "w", encoding="utf-8") as f:
    f.write("caption2-data")

# Clean originals
if os.path.exists(ORIGINALS):
    shutil.rmtree(ORIGINALS)
os.makedirs(ORIGINALS, exist_ok=True)

def post(endpoint, data):
    r = requests.post(BASE_URL + endpoint, json=data)
    try:
        return r.status_code, r.json()
    except Exception:
        return r.status_code, r.text

def test_prune_restore():
    print("1. Prune MEDIA1")
    code, resp = post("/media/prune", {"folder": TEST_FOLDER, "media": MEDIA1})
    print(code, resp)
    assert code == 200
    assert os.path.exists(os.path.join(ORIGINALS, "pruned_test1.mp4"))
    assert os.path.exists(os.path.join(ORIGINALS, "pruned_test1.txt"))
    assert not os.path.exists(os.path.join(TEST_FOLDER, MEDIA1))
    assert not os.path.exists(os.path.join(TEST_FOLDER, CAPTION1))

    print("2. Prune MEDIA1 again (should fail)")
    code, resp = post("/media/prune", {"folder": TEST_FOLDER, "media": MEDIA1})
    print(code, resp)
    assert code == 404

    print("3. Prune MEDIA2 (collision test)")
    shutil.copy2(os.path.join(ORIGINALS, "pruned_test1.mp4"), os.path.join(TEST_FOLDER, MEDIA1))
    shutil.copy2(os.path.join(ORIGINALS, "pruned_test1.txt"), os.path.join(TEST_FOLDER, CAPTION1))
    code, resp = post("/media/prune", {"folder": TEST_FOLDER, "media": MEDIA1})
    print(code, resp)
    assert code == 200
    assert os.path.exists(os.path.join(ORIGINALS, "pruned_test1-1.mp4"))
    assert os.path.exists(os.path.join(ORIGINALS, "pruned_test1-1.txt"))

    print("4. Restore pruned_test1.mp4")
    code, resp = post("/media/restore", {"folder": TEST_FOLDER, "fileName": "pruned_test1.mp4"})
    print(code, resp)
    assert code == 200
    assert os.path.exists(os.path.join(TEST_FOLDER, "test1.mp4"))
    assert os.path.exists(os.path.join(TEST_FOLDER, "test1.txt"))

    print("5. Restore pruned_test1.mp4 again (should fail)")
    code, resp = post("/media/restore", {"folder": TEST_FOLDER, "fileName": "pruned_test1.mp4"})
    print(code, resp)
    assert code == 409

    print("6. Restore pruned_test1-1.mp4 (should restore as test1-1.mp4)")
    code, resp = post("/media/restore", {"folder": TEST_FOLDER, "fileName": "pruned_test1-1.mp4"})
    print(code, resp)
    assert code == 200
    assert os.path.exists(os.path.join(TEST_FOLDER, "test1-1.mp4"))
    assert os.path.exists(os.path.join(TEST_FOLDER, "test1-1.txt"))

    print("7. Prune MEDIA2 (no caption)")
    with open(os.path.join(TEST_FOLDER, MEDIA2), "wb") as f:
        f.write(b"media2-data")
    if os.path.exists(os.path.join(TEST_FOLDER, CAPTION2)):
        os.remove(os.path.join(TEST_FOLDER, CAPTION2))
    code, resp = post("/media/prune", {"folder": TEST_FOLDER, "media": MEDIA2})
    print(code, resp)
    assert code == 200
    assert os.path.exists(os.path.join(ORIGINALS, "pruned_test2.mp4"))
    assert not os.path.exists(os.path.join(ORIGINALS, "pruned_test2.txt"))

    print("8. Restore pruned_test2.mp4 (no caption)")
    code, resp = post("/media/restore", {"folder": TEST_FOLDER, "fileName": "pruned_test2.mp4"})
    print(code, resp)
    assert code == 200
    assert os.path.exists(os.path.join(TEST_FOLDER, "test2.mp4"))
    assert not os.path.exists(os.path.join(TEST_FOLDER, "test2.txt"))

    print("All tests passed.")

if __name__ == "__main__":
    test_prune_restore()
