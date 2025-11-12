from setuptools import setup, find_packages

setup(
    name='MaxPy-lang',
    version='0.1.0',
    author='Ranger Liu',
    author_email='ranger.liu@columbia.edu',
    packages=find_packages(),
    package_data={
        'maxpy': ['data/**/*'],
    },
    scripts=[],
    url='http://pypi.python.org/pypi/MaxPy-lang/',
    license='LICENSE.txt',
    description='Python API for making MaxMSP patches.',
    long_description=open('README.md').read(),
    install_requires=[
        "numpy >= 1.22.0",
        "sphinx_rtd_theme",
        "tabulate",
    ],
)

