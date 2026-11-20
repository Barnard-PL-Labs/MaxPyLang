# Minimal makefile for Sphinx documentation
#

# You can set these variables from the command line, and also
# from the environment for the first two.
SPHINXOPTS    ?=
SPHINXBUILD   ?= sphinx-build
SOURCEDIR     = source
BUILDDIR      = .

# Put it first so that "make" without argument is like "make help".
help:
	@$(SPHINXBUILD) -M help "$(SOURCEDIR)" "$(BUILDDIR)" $(SPHINXOPTS) $(O)

.PHONY: help Makefile

# Catch-all target: route all unknown targets to Sphinx using the new
# "make mode" option.  $(O) is meant as a shortcut for $(SPHINXOPTS).
%: Makefile
	@$(SPHINXBUILD) -M $@ "$(SOURCEDIR)" "$(BUILDDIR)" $(SPHINXOPTS) $(O)

# Copy the built guides into docs/ for GitHub Pages. Removes only what Sphinx writes, by
# name: never index.html and reference-assets/ (the object reference, built by
# docs-site/ after this), py/ (its wheel), app/ (MaxPyStudio) or source/.
SPHINX_OUT = API _sources _static topics guide contents.html install.html tutorial.html \
             support.html indices.html genindex.html search.html py-modindex.html \
             searchindex.js objects.inv llms.txt llms-full.txt .buildinfo

deploy: html
	rm -rf $(SPHINX_OUT)
	mv html/* .
	rm -rf html
