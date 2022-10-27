const prompt = require('prompt');
const path = require('path');
const fs = require('fs/promises');
const AdmZip = require('adm-zip');

const tmpFolderPath = path.join(__dirname, 'tmp');
const supportedReleaseNoteLangs = ['EN', 'AR'];
const supportedReleaseNoteTypes = [
  { key: 'newFeatures', description: 'New Features' },
  { key: 'featureChanges', description: 'Feature Changes' },
  { key: 'bugFixes', description: 'Bug Fixes' },
  { key: 'removedFeatures', description: 'Removed Features' },
  { key: 'notes', description: 'Notes' },
];

async function promptReleaseData() {
  prompt.start();

  const { server } = await prompt.get({
    properties: {
      server: {
        description:
          'Please enter server root folder name. (ex: ../pro11-file-server)',
        type: 'string',
        required: true,
      },
    },
  });

  const serverRoot = path.join(__dirname, server);

  console.log(`     server path: ${serverRoot}`);

  const { versionNumber } = await prompt.get({
    properties: {
      versionNumber: {
        description: 'Enter version number (ex: 2007001064)',
        type: 'number',
        required: true,
        maxLength: 10,
        minLength: 10,
        minimum: 1000000000,
        conform: (value) => {
          // TODO: [Chathuranga] Validate file availability
          return true;
        },
      },
    },
  });

  const releaseSchema = {
    properties: {
      versionName: {
        description: 'Release Version Name',
        type: 'string',
        required: true,
        conform: (value) => {
          const components = value.split('_');

          // DFNPRO11_SA_RETAIL_X_2.007.00.2

          if (components.length !== 5) {
            return false;
          }

          const versionParts = components.pop().split('.');

          if (versionParts.length !== 4) {
            return false;
          }

          return true;
        },
      },
    },
  };

  supportedReleaseNoteLangs.forEach((lang) => {
    supportedReleaseNoteTypes.forEach(({ key, description }) => {
      releaseSchema.properties[`${key}${lang}`] = {
        description: `${description} (${lang})`,
        type: 'array',
        minItems: 0,
      };
    });
  });

  const result = await prompt.get(releaseSchema);

  const releaseNote = {};

  supportedReleaseNoteLangs.forEach((lang) => {
    const langReleaseNote = (releaseNote[lang] = {});

    supportedReleaseNoteTypes.forEach(({ key }) => {
      langReleaseNote[key] = result[`${key}${lang}`];
    });
  });

  releaseNote.version = versionNumber;
  releaseNote.versionName = result.versionName;
  releaseNote.createdDate = new Date()
    .toISOString()
    .split('T')[0]
    .replaceAll('-', '');

  return {
    serverRoot,
    versionNumber,
    releaseNote,
  };
}

async function updateZipArchive(staticServerPath, versionNumber, releaseNote) {
  try {
    const versionFolderPath = path.join(
      staticServerPath,
      versionNumber.toString()
    );

    console.log(`versionFolderPath: "${versionFolderPath}"`);

    const bundledReleaseNoteContent = {
      releases: { [versionNumber]: releaseNote },
      msgType: 1,
    };

    const stringifiedReleaseNote = JSON.stringify(
      bundledReleaseNoteContent,
      null,
      2
    );

    const releaseFiles = (
      await fs.readdir(versionFolderPath, {
        withFileTypes: true,
      })
    )
      .filter((file) => file.isFile() && file.name.endsWith('.zip'))
      .map((file) => path.join(versionFolderPath, file.name));

    for await (const zipFilePath of releaseFiles) {
      console.log('Updating', path.basename(zipFilePath));

      const zip = new AdmZip(zipFilePath);
      zip.extractAllTo(tmpFolderPath, true);

      fs.writeFile(
        `./tmp/${versionNumber}/releaseNote.json`,
        stringifiedReleaseNote
      );

      const updatedZip = new AdmZip();
      await updatedZip.addLocalFolderPromise(tmpFolderPath);
      await updatedZip.writeZipPromise(zipFilePath, { overwrite: true });
      await fs.rm(tmpFolderPath, { recursive: true, force: true });

      console.log(`Updated ${zipFilePath} successfully`);
    }

    console.log(`Release files update successfully`);
  } catch (e) {
    throw new Error(`Release update failed: ${e}`);
  }
}

async function updatePrevReleases(
  staticServerPath,
  versionNumber,
  releaseNote
) {
  try {
    const prevReleasesFilePath = path.join(
      staticServerPath,
      'prevReleases.json'
    );

    console.log(`Updating ${prevReleasesFilePath}`);

    const data = await fs.readFile(prevReleasesFilePath, 'utf-8');
    const content = JSON.parse(data);
    content.releases[versionNumber] = releaseNote;

    await fs.writeFile(prevReleasesFilePath, JSON.stringify(content, null, 2));

    console.log('Previous releases file updated successfully');
  } catch (e) {
    throw new Error('Error while updating prev releases file', e);
  }
}

async function updateVersionInfo(staticServerPath, versionNumber) {
  try {
    const versionFilePath = path.join(staticServerPath, 'versionInfo.json');

    console.log(`Updating ${versionFilePath}`);

    const data = await fs.readFile(versionFilePath, 'utf-8');
    const content = JSON.parse(data);
    content.app = versionNumber;

    await fs.writeFile(versionFilePath, JSON.stringify(content, null, 2));

    console.log('Version info file updated successfully');
  } catch (e) {
    throw new Error('Error while updating version info file', e);
  }
}

(async () => {
  const { serverRoot, versionNumber, releaseNote } = await promptReleaseData();

  const staticServerPath = path.join(serverRoot, 'fileserver/http/public');

  await updateZipArchive(staticServerPath, versionNumber, releaseNote);
  await updatePrevReleases(staticServerPath, versionNumber, releaseNote);
  await updateVersionInfo(staticServerPath, versionNumber);

  console.log('Release update successful');
})();
