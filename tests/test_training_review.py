from pathlib import Path

import tomllib
from PIL import Image

from tool.server import training_bundle, training_review
from tool.server.training_config_files import apply_review_config_settings
from tool.server.folder_state_store import FolderStateUnsafeWriteError, reject_wholesale_state_map_clear
from tool.server.training_profiles import MINIMAX_H3_PROFILE_ID, profile_for_mode


def test_review_config_rewrite_preserves_comments_and_unknown_keys():
    source = (
        '# keep this comment\nforce_constant_lr = 1e-5 # schedule override\n'
        '[adapter]\nrank = 16 # old rank\ncustom_shape = "preserve"\n'
        '[optimizer]\nlr = 0.00006 # old LR\nunknown = true\n'
    )

    updated = apply_review_config_settings(source, {
        'optimizerLr': '0.00004', 'adapterRank': '32', 'adapterDropout': '0.1', 'forceConstantLr': '',
    })

    parsed = tomllib.loads(updated)
    assert parsed['optimizer']['lr'] == 0.00004
    assert parsed['optimizer']['unknown'] is True
    assert parsed['adapter']['rank'] == 32
    assert parsed['adapter']['dropout'] == 0.1
    assert parsed['adapter']['custom_shape'] == 'preserve'
    assert 'force_constant_lr' not in parsed
    assert '# keep this comment' in updated


def test_representable_dataset_imports_bucket_choices():
    setup = profile_for_mode(MINIMAX_H3_PROFILE_ID, 'normal')
    plan = {
        'version': 1, 'revision': 1,
        'stages': {'h3': {'targetSteps': 20000, 'imageBuckets': {}}},
        'videoRoles': [
            {'id': 'temporal', 'enabled': True, 'frames': 68, 'weight': 1.0, 'buckets': {}},
            {'id': 'detail', 'enabled': True, 'frames': 17, 'weight': 0.25, 'buckets': {}},
        ],
    }
    normalized = training_review.normalize_profile_plan(plan, MINIMAX_H3_PROFILE_ID, setup)
    text = (
        '[[directory]]\npath = "images"\nnum_repeats = 1\ngroup = "images"\nsize_buckets = [[512, 512, 1]]\n\n'
        '[[directory]]\npath = "clips"\nnum_repeats = 1\ngroup = "videos"\nsize_buckets = [[352, 352, 68]]\n'
    )

    imported = training_review._import_representable_dataset(text, MINIMAX_H3_PROFILE_ID, 'h3', normalized)

    assert imported['stages']['h3']['imageBuckets']['square'] == [[512, 512]]
    assert imported['videoRoles'][0]['buckets']['square'] == [[352, 352]]


def test_custom_dataset_is_not_imported():
    setup = profile_for_mode(MINIMAX_H3_PROFILE_ID, 'normal')
    plan = training_review.normalize_profile_plan({
        'stages': {'h3': {'targetSteps': 20000}}, 'videoRoles': [],
    }, MINIMAX_H3_PROFILE_ID, setup)

    assert training_review._import_representable_dataset(
        '[[directory]]\npath = "images"\ngroup = "images"\ncustom_option = true\nsize_buckets = [[512, 512, 1]]\n',
        MINIMAX_H3_PROFILE_ID, 'h3', plan,
    ) is None


def test_review_bundle_uses_exact_membership(tmp_path, monkeypatch):
    media = tmp_path / 'media'
    source = media / 'square'
    source.mkdir(parents=True)
    (source / 'only.png').write_bytes(b'image')
    (source / 'only.txt').write_text('caption', encoding='utf-8')
    monkeypatch.setattr(training_bundle, 'to_wsl_path', lambda path, distribution='': '/mnt/' + Path(path).name)

    rendered = training_bundle._materialize_review_stage_dataset('h3', {
        'datasetEntries': [{
            'kind': 'image', 'role': 'image', 'bucket': [512, 512], 'sourceDir': 'square',
            'files': ['only.png'], 'numRepeats': 3,
        }],
    }, media, '')

    captured = media / 'review' / 'h3' / '000-image'
    assert (captured / 'only.png').is_file()
    assert (captured / 'only.txt').is_file()
    assert 'num_repeats = 3' in rendered
    assert tomllib.loads(rendered)['directory'][0]['size_buckets'] == [[512, 512]]


def test_folder_state_rejects_accidental_training_plan_erasure():
    previous = {'trainingPlan': {'version': 1, 'profiles': {'minimax_h3': {'revision': 2}}}}

    try:
        reject_wholesale_state_map_clear(previous, {'trainingPlan': {}})
    except FolderStateUnsafeWriteError:
        pass
    else:
        raise AssertionError('trainingPlan must be protected from an ordinary empty-state save')


def test_candidate_counts_preview_reassignment_for_disabled_bucket():
    plan = {
        'stages': {'h3': {'imageBuckets': {'square': [[512, 512]]}}},
        'videoRoles': [
            {'id': 'temporal', 'enabled': True, 'frames': 68, 'weight': 1.0, 'buckets': {'square': [[352, 352]]}},
            {'id': 'detail', 'enabled': True, 'frames': 17, 'weight': 0.25, 'buckets': {'square': [[512, 512]]}},
        ],
    }
    manifest = {
        'images': [
            {'ar': 'square', 'width': 768, 'height': 768, 'prepared_path': 'square/high.png'},
            {'ar': 'square', 'width': 448, 'height': 448, 'prepared_path': 'square/low.png'},
        ],
        'videos': [],
    }
    ladders = training_review._ladders(MINIMAX_H3_PROFILE_ID, plan, manifest)

    counts = training_review._candidate_counts(MINIMAX_H3_PROFILE_ID, plan, manifest, ladders)

    assert counts['images']['h3']['square']['768x768'] == 1
    assert counts['images']['h3']['square']['512x512'] == 2


def test_prepare_review_returns_effective_tomls_and_predictive_counts(tmp_path):
    folder = tmp_path / 'set'
    folder.mkdir()
    Image.new('RGB', (768, 768), color=(12, 24, 36)).save(folder / 'one.png')
    (folder / 'one.txt').write_text('one subject', encoding='utf-8')

    payload = training_review.prepare_training_review(
        folder, MINIMAX_H3_PROFILE_ID, 'train', ['one.png'], total_media_count=1,
    )

    assert payload['ok'] is True
    assert payload['effectiveToml']['h3']['configName'] == 'config.h3.normal.toml'
    assert payload['effectiveToml']['h3']['datasetName'] == 'dataset.h3.normal.toml'
    assert payload['candidateCounts']['images']['h3']['square']['768x768'] == 1


def test_review_run_choice_contains_only_selected_wan_stage(tmp_path):
    folder = tmp_path / 'set'
    folder.mkdir()
    Image.new('RGB', (512, 512), color=(12, 24, 36)).save(folder / 'one.png')
    (folder / 'one.txt').write_text('one subject', encoding='utf-8')

    payload = training_review.prepare_training_review(
        folder, 'wan22_t2v', 'hi', ['one.png'], total_media_count=1,
    )

    assert list(payload['review']['stages']) == ['hi']
    assert list(payload['effectiveToml']) == ['hi']
    assert (folder / 'dataset.wan22.normal.lo.toml').is_file()
    assert (folder / 'dataset.wan22.normal.lo.toml').read_text(encoding='utf-8').strip()
