const express = require('express');
const axios = require('axios');
const cheerio = require('cheerio');
const cors = require('cors');

const app = express();
const port = process.env.PORT || 3001;

app.use(cors());

// Middleware to check for AUTHORIZATION header
app.use((req, res, next) => {
  const apiKey = req.headers['authorization'];
  if (!apiKey) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  // Here you would typically validate the API key
  // For now, we'll just pass it through
  next();
});

class AudiotekaProvider {
  constructor() {
    this.id = 'audioteka';
    this.name = 'Audioteka';
    this.baseUrl = 'https://audioteka.com';
    this.searchUrl = 'https://audioteka.com/pl/search';
  }

  async searchBooks(query, author = '') {
    try {
      console.log(`Searching for: "${query}" by "${author}"`);
      const searchUrl = `${this.searchUrl}?query=${encodeURIComponent(query)}`;
      
      const response = await axios.get(searchUrl);
      const $ = cheerio.load(response.data);

      console.log('Search URL:', searchUrl);

      const matches = [];
      const $books = $('.adtk-item.teaser_teaser__kRYek');
      console.log('Number of books found:', $books.length);

      $books.each((index, element) => {
        const $book = $(element);
        
        const title = $book.find('.teaser_title__CZ9eq').text().trim();
        const bookUrl = this.baseUrl + $book.find('.teaser_mainLink__YBhax').attr('href');
        const authors = [$book.find('.teaser_author__BV8Ke').text().trim()];
        const cover = $book.find('.teaser_cover__2EVLn').attr('src');
        const rating = parseFloat($book.find('.teaser_rating__ksFn3').text().trim()) || null;

        const id = $book.attr('data-item-id') || bookUrl.split('/').pop();

        if (title && bookUrl && authors.length > 0) {
          matches.push({
            id,
            title,
            authors,
            url: bookUrl,
            cover,
            rating,
            source: {
              id: this.id,
              description: this.name,
              link: this.baseUrl,
            },
          });
        }
      });

      const fullMetadata = await Promise.all(matches.map(match => this.getFullMetadata(match)));
      return { matches: fullMetadata };
    } catch (error) {
      console.error('Error searching books:', error.message, error.stack);
      return { matches: [] };
    }
  }

  async getFullMetadata(match) {
    try {
      console.log(`Fetching full metadata for: ${match.title}`);
      const response = await axios.get(match.url);
      const $ = cheerio.load(response.data);

      // Get narrator from the "Głosy" row in the details table
      const narrator = $('tr:contains("Głosy") td:last-child a').text().trim();

      // Get duration from the "Długość" row
      const duration = $('tr:contains("Długość") td:last-child').text().trim();

      // Get publisher from the "Wydawca" row
      const publisher = $('tr:contains("Wydawca") td:last-child a').text().trim();

      // Get type from the "Typ" row
      const type = $('tr:contains("Typ") td:last-child').text().trim();

      // Get categories/genres
      const genres = $('tr:contains("Kategoria") td:last-child a')
        .map((i, el) => $(el).text().trim())
        .get();

      // Get series information
      const series = $('.Collections__CollectionList-sc-cd06413d-1 a')
        .map((i, el) => $(el).text().trim())
        .get();

      // Get rating
      const rating = parseFloat($('.StarIcon__Label-sc-96b8391b-2').text().trim()) || null;

      // Get main cover image
      const cover = $('.ProductTop-styled__Cover-sc-aae7c7ba-0').attr('src') || match.cover;

      const fullMetadata = {
        ...match,
        cover,
        narrator,
        duration,
        publisher,
        type,
        genres,
        series: series.length > 0 ? series[0] : undefined, // Taking first series if multiple exist
        rating,
        languages: ['pol'], // Assuming Polish language for Audioteka
        identifiers: {
          audioteka: match.id,
        },
      };

      console.log(`Full metadata for ${match.title}:`, JSON.stringify(fullMetadata, null, 2));
      return fullMetadata;
    } catch (error) {
      console.error(`Error fetching full metadata for ${match.title}:`, error.message, error.stack);
      // Return basic metadata if full metadata fetch fails
      return match;
    }
  }
}

const provider = new AudiotekaProvider();

app.get('/search', async (req, res) => {
  try {
    console.log('Received search request:', req.query);
    const query = req.query.query;
    const author = req.query.author;

    if (!query) {
      return res.status(400).json({ error: 'Query parameter is required' });
    }

    const results = await provider.searchBooks(query, author);
    
    // Format the response according to the OpenAPI specification
    const formattedResults = {
      matches: results.matches.map(book => ({
        title: book.title,
        subtitle: book.subtitle || undefined,
        author: book.authors.join(', '),
        narrator: book.narrator || undefined,
        publisher: book.publisher || undefined,
        publishedYear: book.publishedDate ? new Date(book.publishedDate).getFullYear().toString() : undefined,
        description: book.description || undefined,
        cover: book.cover || undefined,
        isbn: book.identifiers?.isbn || undefined,
        asin: book.identifiers?.asin || undefined,
        genres: book.genres || undefined,
        tags: book.tags || undefined,
        series: book.series ? [{
          series: book.series,
          sequence: undefined // Audioteka doesn't seem to provide sequence numbers
        }] : undefined,
        language: book.languages && book.languages.length > 0 ? book.languages[0] : undefined,
        duration: book.duration || undefined
      }))
    };

    console.log('Sending response:', JSON.stringify(formattedResults, null, 2));
    res.json(formattedResults);
  } catch (error) {
    console.error('Search error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.listen(port, () => {
  console.log(`Audioteka provider listening on port ${port}`);
});